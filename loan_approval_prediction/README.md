# Vanguard Credit Risk Analytics - Deployment Package

Ready-to-deploy package for the Vanguard Credit Risk Assessment web dashboard.

## Cloud Deployment Options

### 1. Render.com (Recommended - 100% Free)
1. Push this folder to a GitHub repository or connect via Git.
2. Sign in to https://render.com and click **New + > Web Service**.
3. Select your repository.
4. Settings:
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `gunicorn --bind 0.0.0.0:$PORT --workers 2 app:app`
5. Click **Create Web Service**. Your dashboard will be live online in ~2 minutes!

### 2. Railway.app
1. Go to https://railway.app and click **New Project**.
2. Select **Deploy from GitHub repo** or upload directory.
3. Railway automatically detects `Dockerfile` or `Procfile` and deploys.

### 3. Hugging Face Spaces
1. Create a new Space at https://huggingface.co/spaces
2. Select **Docker** or **Gradio/Flask**.
3. Upload all files from this package.

### 4. Local Test
```bash
pip install -r requirements.txt
python app.py
```
Open http://127.0.0.1:5000 in your browser.
