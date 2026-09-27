import os
import json
import joblib
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder='static', static_url_path='')

# Paths for models and configuration
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.path.exists(os.path.join(BASE_DIR, 'models')):
    MODEL_DIR = os.path.join(BASE_DIR, 'models')
else:
    MODEL_DIR = os.path.join(os.path.dirname(BASE_DIR), 'models')
CONFIG_PATH = os.path.join(BASE_DIR, 'feature_config.json')

# Load feature configurations
with open(CONFIG_PATH, 'r') as f:
    config_data = json.load(f)

FEATURE_ORDER = config_data['feature_order']
DEFAULTS = config_data['defaults']
UI_FEATURES = config_data['ui_features']

# Load ML models
print("Loading pre-trained models...")
xgb_model = joblib.load(os.path.join(MODEL_DIR, 'xgboost_model.pkl'))
imputer = joblib.load(os.path.join(MODEL_DIR, 'imputer.pkl'))
scaler = joblib.load(os.path.join(MODEL_DIR, 'scaler.pkl'))
print("Models loaded successfully!")

def calibrate_probability(raw_prob):
    # Clamp to avoid log(0) or log(1) errors
    raw_prob = max(0.0001, min(0.9999, raw_prob))
    # log-odds shift calibration (+1.23 shift maps average raw 2.5% to actual 8.07%)
    logit = np.log(raw_prob / (1.0 - raw_prob))
    calibrated_logit = logit + 1.23
    calibrated_prob = 1.0 / (1.0 + np.exp(-calibrated_logit))
    return float(calibrated_prob)



@app.route('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.route('/api/features', methods=['GET'])
def get_features():
    """Returns metadata of features required for the UI form."""
    return jsonify(UI_FEATURES)

@app.route('/api/predict', methods=['POST'])
def predict():
    """Predicts credit risk for a single applicant."""
    try:
        data = request.json or {}
        
        # 1. Initialize input dictionary with defaults
        input_dict = DEFAULTS.copy()
        
        # 2. Map UI inputs to model features
        for key, val in data.items():
            if key == 'NAME_EDUCATION_TYPE':
                # Handle education one-hot encoding
                if val == 'NAME_EDUCATION_TYPE_Higher education':
                    input_dict['NAME_EDUCATION_TYPE_Higher education'] = 1.0
                    input_dict['NAME_EDUCATION_TYPE_Secondary / secondary special'] = 0.0
                elif val == 'NAME_EDUCATION_TYPE_Secondary / secondary special':
                    input_dict['NAME_EDUCATION_TYPE_Higher education'] = 0.0
                    input_dict['NAME_EDUCATION_TYPE_Secondary / secondary special'] = 1.0
                else: # other
                    input_dict['NAME_EDUCATION_TYPE_Higher education'] = 0.0
                    input_dict['NAME_EDUCATION_TYPE_Secondary / secondary special'] = 0.0
            elif key in input_dict:
                # Convert input to float/numeric
                try:
                    input_dict[key] = float(val)
                except (ValueError, TypeError):
                    pass
        
        # Dynamic calculation: CREDIT_TERM = AMT_ANNUITY / AMT_CREDIT (if not explicitly provided or to keep consistent)
        if 'AMT_ANNUITY' in data and 'AMT_CREDIT' in data:
            try:
                credit = float(data['AMT_CREDIT'])
                annuity = float(data['AMT_ANNUITY'])
                if credit > 0:
                    input_dict['CREDIT_TERM'] = annuity / credit
            except Exception:
                pass
                
        # 3. Create DataFrame in correct column order
        df_input = pd.DataFrame([input_dict])[FEATURE_ORDER]
        
        # 4. Apply Imputation and Scaling
        imputed_arr = imputer.transform(df_input)
        scaled_arr = scaler.transform(imputed_arr)
        
        # 5. Predict and Calibrate
        raw_prob_default = float(xgb_model.predict_proba(scaled_arr)[0][1])
        prob_default = calibrate_probability(raw_prob_default)
        prob_repay = 1.0 - prob_default
        
        # Risk assessment levels directly based on calibrated probability
        if prob_default <= 0.05:
            risk_rating = 'Low Risk (Excellent)'
            risk_class = 'risk-low'
        elif prob_default <= 0.15:
            risk_rating = 'Moderate Risk (Good)'
            risk_class = 'risk-medium'
        else:
            risk_rating = 'High Risk (Critical)'
            risk_class = 'risk-high'
            
        # Extract key factors contributing to risk
        # Find which inputs deviate from the median/favorable values
        reasons = []
        if input_dict.get('EXT_SOURCE_3', 0.5) < 0.35:
            reasons.append("Low External Credit Rating Source 3 score.")
        if input_dict.get('EXT_SOURCE_2', 0.5) < 0.35:
            reasons.append("Low External Credit Rating Source 2 score.")
        if input_dict.get('DEF_60_CNT_SOCIAL_CIRCLE', 0) > 1:
            reasons.append("Frequent historical defaults in the client's social circle.")
        if input_dict.get('EMPLOYMENT_YEARS', 5) < 2:
            reasons.append("Short employment duration (less than 2 years).")
        if input_dict.get('AMT_CREDIT', 0) > 1000000 and input_dict.get('AMT_INCOME_TOTAL', 1) > 0:
            ratio = float(input_dict.get('AMT_CREDIT', 0)) / float(input_dict.get('AMT_INCOME_TOTAL', 1))
            if ratio > 5:
                reasons.append(f"High Debt-to-Income request (Credit is {ratio:.1f}x annual income).")
                
        if not reasons:
            reasons.append("Strong financial indicators and external ratings.")
            
        return jsonify({
            'success': True,
            'probability_default': prob_default,
            'probability_repay': prob_repay,
            'risk_rating': risk_rating,
            'risk_class': risk_class,
            'reasons': reasons
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@app.route('/api/predict_batch', methods=['POST'])
def predict_batch():
    """Predicts credit risk for multiple applicants uploaded via a CSV file."""
    try:
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'No file part in the request'}), 400
            
        file = request.files['file']
        if file.filename == '':
            return jsonify({'success': False, 'error': 'No file selected'}), 400
            
        if not file.filename.endswith('.csv'):
            return jsonify({'success': False, 'error': 'Only CSV files are supported'}), 400
            
        # Read uploaded CSV
        uploaded_df = pd.read_csv(file)
        
        if uploaded_df.empty:
            return jsonify({'success': False, 'error': 'Uploaded CSV is empty'}), 400
            
        # Prepare DataFrame with all 183 features
        num_rows = len(uploaded_df)
        prepared_data = {col: np.full(num_rows, DEFAULTS[col]) for col in FEATURE_ORDER}
        
        # Check and handle education columns if they exist in raw form or if they exist in pre-processed form
        # We try to map common names in uploaded CSV to model features
        for col in uploaded_df.columns:
            if col in prepared_data:
                # Copy values, filling NaNs with default
                prepared_data[col] = uploaded_df[col].fillna(DEFAULTS[col]).values
            elif col == 'NAME_EDUCATION_TYPE':
                # Handle raw education mapping
                for idx, val in enumerate(uploaded_df['NAME_EDUCATION_TYPE']):
                    if val == 'Higher education':
                        prepared_data['NAME_EDUCATION_TYPE_Higher education'][idx] = 1.0
                        prepared_data['NAME_EDUCATION_TYPE_Secondary / secondary special'][idx] = 0.0
                    elif val == 'Secondary / secondary special' or val == 'Secondary education':
                        prepared_data['NAME_EDUCATION_TYPE_Higher education'][idx] = 0.0
                        prepared_data['NAME_EDUCATION_TYPE_Secondary / secondary special'][idx] = 1.0
                    else:
                        prepared_data['NAME_EDUCATION_TYPE_Higher education'][idx] = 0.0
                        prepared_data['NAME_EDUCATION_TYPE_Secondary / secondary special'][idx] = 0.0
            elif col == 'CODE_GENDER':
                for idx, val in enumerate(uploaded_df['CODE_GENDER']):
                    prepared_data['CODE_GENDER_M'][idx] = 1.0 if val in ['M', 'Male', 1] else 0.0
            elif col == 'FLAG_OWN_CAR':
                for idx, val in enumerate(uploaded_df['FLAG_OWN_CAR']):
                    prepared_data['FLAG_OWN_CAR_Y'][idx] = 1.0 if val in ['Y', 'Yes', 1] else 0.0
            elif col == 'NAME_FAMILY_STATUS':
                for idx, val in enumerate(uploaded_df['NAME_FAMILY_STATUS']):
                    prepared_data['NAME_FAMILY_STATUS_Married'][idx] = 1.0 if val in ['Married', 1] else 0.0
            elif col == 'NAME_INCOME_TYPE':
                for idx, val in enumerate(uploaded_df['NAME_INCOME_TYPE']):
                    prepared_data['NAME_INCOME_TYPE_Pensioner'][idx] = 1.0 if val in ['Pensioner', 'Retired'] else 0.0
            elif col == 'OCCUPATION_TYPE':
                for idx, val in enumerate(uploaded_df['OCCUPATION_TYPE']):
                    prepared_data['OCCUPATION_TYPE_Core staff'][idx] = 1.0 if val in ['Core staff'] else 0.0
            elif col == 'NAME_CONTRACT_TYPE':
                for idx, val in enumerate(uploaded_df['NAME_CONTRACT_TYPE']):
                    prepared_data['NAME_CONTRACT_TYPE_Revolving loans'][idx] = 1.0 if val in ['Revolving loans', 'Revolving'] else 0.0
            elif col == 'DAYS_BIRTH':
                # Convert DAYS_BIRTH (negative) to AGE (positive)
                for idx, val in enumerate(uploaded_df['DAYS_BIRTH']):
                    if not pd.isna(val):
                        prepared_data['AGE'][idx] = abs(val) / 365.0
            elif col == 'DAYS_EMPLOYED':
                for idx, val in enumerate(uploaded_df['DAYS_EMPLOYED']):
                    if not pd.isna(val) and val < 0:
                        prepared_data['EMPLOYMENT_YEARS'][idx] = abs(val) / 365.0
                    else:
                        prepared_data['EMPLOYMENT_YEARS'][idx] = 0.0

        # Construct final aligned DataFrame
        aligned_df = pd.DataFrame(prepared_data)[FEATURE_ORDER]
        
        # Fill standard credit term if missing or invalid
        if 'CREDIT_TERM' not in uploaded_df.columns:
            if 'AMT_ANNUITY' in uploaded_df.columns and 'AMT_CREDIT' in uploaded_df.columns:
                for idx in range(num_rows):
                    try:
                        credit = float(uploaded_df['AMT_CREDIT'].iloc[idx])
                        annuity = float(uploaded_df['AMT_ANNUITY'].iloc[idx])
                        if credit > 0:
                            aligned_df.at[idx, 'CREDIT_TERM'] = annuity / credit
                    except Exception:
                        pass
        
        # Run Imputation & Scaling
        imputed_arr = imputer.transform(aligned_df)
        scaled_arr = scaler.transform(imputed_arr)
        
        # Run predictions
        pred_probs_raw = xgb_model.predict_proba(scaled_arr)[:, 1]
        
        # Compile results
        results = []
        calibrated_probs = []
        risk_counts = {'Low': 0, 'Medium': 0, 'High': 0}
        
        for idx in range(num_rows):
            prob_def = calibrate_probability(float(pred_probs_raw[idx]))
            prob_rep = 1.0 - prob_def
            calibrated_probs.append(prob_def)
            
            if prob_def <= 0.05:
                rating = 'Low Risk'
                risk_counts['Low'] += 1
            elif prob_def <= 0.15:
                rating = 'Moderate Risk'
                risk_counts['Medium'] += 1
            else:
                rating = 'High Risk'
                risk_counts['High'] += 1
                
            # Get ID if exists
            applicant_id = str(uploaded_df['SK_ID_CURR'].iloc[idx]) if 'SK_ID_CURR' in uploaded_df.columns else f"APP_{idx+100001}"
            
            results.append({
                'id': applicant_id,
                'prob_default': prob_def,
                'prob_repay': prob_rep,
                'rating': rating,
                'income': float(uploaded_df['AMT_INCOME_TOTAL'].iloc[idx]) if 'AMT_INCOME_TOTAL' in uploaded_df.columns else float(DEFAULTS['AMT_INCOME_TOTAL']),
                'credit': float(uploaded_df['AMT_CREDIT'].iloc[idx]) if 'AMT_CREDIT' in uploaded_df.columns else float(DEFAULTS['AMT_CREDIT'])
            })
            
        summary = {
            'total': num_rows,
            'low_risk_count': risk_counts['Low'],
            'medium_risk_count': risk_counts['Medium'],
            'high_risk_count': risk_counts['High'],
            'avg_default_rate': float(np.mean(calibrated_probs)) if calibrated_probs else 0.0,
            'avg_repayment_rate': float(1.0 - np.mean(calibrated_probs)) if calibrated_probs else 0.0
        }
        
        return jsonify({
            'success': True,
            'results': results,
            'summary': summary
        })
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port)
