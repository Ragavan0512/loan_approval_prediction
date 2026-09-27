document.addEventListener('DOMContentLoaded', () => {
    // --- Navigation & Tab Switching ---
    const navButtons = document.querySelectorAll('.nav-btn');
    const tabPanes = document.querySelectorAll('.tab-pane');

    navButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetTab = btn.getAttribute('data-tab');
            
            navButtons.forEach(b => b.classList.remove('active'));
            tabPanes.forEach(t => t.classList.remove('active'));

            btn.classList.add('active');
            document.getElementById(targetTab).classList.add('active');
        });
    });

    // --- Dynamic Slider Values ---
    const sliders = [
        { id: 'input-AGE', valId: 'val-AGE', suffix: ' years' },
        { id: 'input-EMPLOYMENT_YEARS', valId: 'val-EMPLOYMENT_YEARS', suffix: ' years' },
        { id: 'input-EXT_SOURCE_2', valId: 'val-EXT_SOURCE_2', suffix: '' },
        { id: 'input-EXT_SOURCE_3', valId: 'val-EXT_SOURCE_3', suffix: '' }
    ];

    sliders.forEach(slider => {
        const sliderEl = document.getElementById(slider.id);
        const valEl = document.getElementById(slider.valId);
        
        if (sliderEl && valEl) {
            sliderEl.addEventListener('input', (e) => {
                valEl.textContent = e.target.value + slider.suffix;
            });
        }
    });

    // --- Calculate Credit Term Ratio Dynamically ---
    const creditInput = document.getElementById('input-AMT_CREDIT');
    const annuityInput = document.getElementById('input-AMT_ANNUITY');
    const termRatioEl = document.getElementById('calc-credit-term');

    function updateCreditTerm() {
        const credit = parseFloat(creditInput.value) || 0;
        const annuity = parseFloat(annuityInput.value) || 0;
        
        if (credit > 0 && annuity > 0) {
            const ratio = annuity / credit;
            termRatioEl.textContent = ratio.toFixed(4);
        } else {
            termRatioEl.textContent = '0.0500';
        }
    }

    if (creditInput && annuityInput) {
        creditInput.addEventListener('input', updateCreditTerm);
        annuityInput.addEventListener('input', updateCreditTerm);
        // Run once on load
        updateCreditTerm();
    }

    // --- Single Prediction API Call ---
    const form = document.getElementById('prediction-form');
    const singlePlaceholder = document.getElementById('single-placeholder');
    const singleDisplay = document.getElementById('single-result-display');
    const resultScore = document.getElementById('result-score');
    const resultRating = document.getElementById('result-rating');
    const resultProbRepay = document.getElementById('result-prob-repay');
    const resultProbDefault = document.getElementById('result-prob-default');
    const resultReasons = document.getElementById('result-reasons');
    const gaugeCircle = document.getElementById('gauge-circle');

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        // Disable submit button and show loading state
        const submitBtn = document.getElementById('btn-submit');
        const originalBtnText = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Assessing...';

        // Gather form data
        const formData = new FormData(form);
        const payload = {};
        formData.forEach((value, key) => {
            payload[key] = value;
        });

        try {
            const response = await fetch('/api/predict', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (result.success) {
                // Hide placeholder and show display
                singlePlaceholder.classList.add('hidden');
                singleDisplay.classList.remove('hidden');

                // Animate Gauge (Repayment Probability)
                const repayProb = result.probability_repay;
                resultScore.textContent = (repayProb * 100).toFixed(1) + '%';
                
                // Map Repayment Prob to Gauge Stroke Dashoffset (0% to 100%)
                const dashoffset = 502 * (1 - repayProb);
                gaugeCircle.style.strokeDashoffset = dashoffset;

                // Color stroke and badge based on risk class
                let strokeColor = '#3b82f6';
                resultRating.className = 'risk-badge';

                if (result.risk_class === 'risk-low') {
                    strokeColor = '#10b981';
                    resultRating.classList.add('risk-low');
                    resultReasons.parentElement.className = 'risk-factors risk-low-reasons';
                } else if (result.risk_class === 'risk-medium') {
                    strokeColor = '#f59e0b';
                    resultRating.classList.add('risk-medium');
                    resultReasons.parentElement.className = 'risk-factors';
                } else {
                    strokeColor = '#ef4444';
                    resultRating.classList.add('risk-high');
                    resultReasons.parentElement.className = 'risk-factors';
                }
                
                gaugeCircle.style.stroke = strokeColor;
                resultRating.textContent = result.risk_rating;

                // Values
                resultProbRepay.textContent = (result.probability_repay * 100).toFixed(1) + '%';
                resultProbDefault.textContent = (result.probability_default * 100).toFixed(1) + '%';

                // Reasons
                resultReasons.innerHTML = '';
                result.reasons.forEach(reason => {
                    const li = document.createElement('li');
                    li.textContent = reason;
                    resultReasons.appendChild(li);
                });
            } else {
                alert('Prediction failed: ' + result.error);
            }
        } catch (error) {
            console.error('Error during prediction:', error);
            alert('An error occurred during risk assessment. Please check backend connection.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnText;
        }
    });

    // Reset Form
    document.getElementById('btn-reset').addEventListener('click', () => {
        form.reset();
        updateCreditTerm();
        // Update slider texts
        document.getElementById('val-AGE').textContent = '43 years';
        document.getElementById('val-EMPLOYMENT_YEARS').textContent = '4.5 years';
        document.getElementById('val-EXT_SOURCE_2').textContent = '0.56';
        document.getElementById('val-EXT_SOURCE_3').textContent = '0.53';

        // Reset result displays
        singlePlaceholder.classList.remove('hidden');
        singleDisplay.classList.add('hidden');
        gaugeCircle.style.strokeDashoffset = 502;
    });


    // --- Batch Analysis Logic ---
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('batch-file-input');
    const fileInfoContainer = document.getElementById('file-info-container');
    const fileNameDisplay = document.getElementById('file-name-display');
    const fileSizeDisplay = document.getElementById('file-size-display');
    const btnRemoveFile = document.getElementById('btn-remove-file');
    const btnRunBatch = document.getElementById('btn-run-batch');
    const batchLoading = document.getElementById('batch-loading');
    const batchResultsDisplay = document.getElementById('batch-results-display');
    
    let uploadedFile = null;
    let batchResultsData = null; // Store globally for export

    // Dropzone Click
    dropzone.addEventListener('click', () => fileInput.click());

    // File Selected
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // Drag & Drop
    ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
            e.preventDefault();
            dropzone.classList.remove('dragover');
        }, false);
    });

    dropzone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        handleFiles(dt.files);
    });

    function handleFiles(files) {
        if (files.length > 0) {
            const file = files[0];
            if (file.type === 'text/csv' || file.name.endsWith('.csv')) {
                uploadedFile = file;
                fileNameDisplay.textContent = file.name;
                
                // Format size
                const sizeKB = (file.size / 1024).toFixed(1);
                fileSizeDisplay.textContent = sizeKB > 1024 ? (sizeKB / 1024).toFixed(1) + ' MB' : sizeKB + ' KB';
                
                dropzone.classList.add('hidden');
                fileInfoContainer.classList.remove('hidden');
            } else {
                alert('Only CSV files are supported.');
            }
        }
    }

    // Remove Selected File
    btnRemoveFile.addEventListener('click', (e) => {
        e.stopPropagation();
        uploadedFile = null;
        fileInput.value = '';
        dropzone.classList.remove('hidden');
        fileInfoContainer.classList.add('hidden');
        batchResultsDisplay.classList.add('hidden');
    });

    // Run Batch Predictions
    btnRunBatch.addEventListener('click', async () => {
        if (!uploadedFile) return;

        fileInfoContainer.classList.add('hidden');
        batchLoading.classList.remove('hidden');
        batchResultsDisplay.classList.add('hidden');

        const formData = new FormData();
        formData.append('file', uploadedFile);

        try {
            const response = await fetch('/api/predict_batch', {
                method: 'POST',
                body: formData
            });

            const result = await response.json();

            if (result.success) {
                batchResultsData = result;
                renderBatchResults(result);
            } else {
                alert('Batch processing failed: ' + result.error);
                fileInfoContainer.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error running batch predictions:', error);
            alert('An error occurred during batch execution.');
            fileInfoContainer.classList.remove('hidden');
        } finally {
            batchLoading.classList.add('hidden');
        }
    });

    // Global Chart Variables to destroy previous instances
    let distChartInstance = null;
    let scatterChartInstance = null;

    function renderBatchResults(data) {
        batchResultsDisplay.classList.remove('hidden');
        
        // Set Summary Cards
        document.getElementById('summary-total').textContent = data.summary.total;
        document.getElementById('summary-avg-repay').textContent = (data.summary.avg_repayment_rate * 100).toFixed(1) + '%';
        document.getElementById('summary-avg-default').textContent = (data.summary.avg_default_rate * 100).toFixed(1) + '%';
        document.getElementById('summary-high-risk').textContent = data.summary.high_risk_count;

        // Render Table Rows
        const tbody = document.getElementById('table-body');
        tbody.innerHTML = '';
        
        // Show first 15 records in the UI table to keep performance high
        const tableRecords = data.results.slice(0, 15);
        tableRecords.forEach(record => {
            const tr = document.createElement('tr');
            
            // Format risk cell
            let pillClass = 'pill-low';
            if (record.rating === 'Moderate Risk') pillClass = 'pill-medium';
            if (record.rating === 'High Risk') pillClass = 'pill-high';

            tr.innerHTML = `
                <td><strong>${record.id}</strong></td>
                <td>$${record.income.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td>$${record.credit.toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                <td>${(record.prob_default * 100).toFixed(1)}%</td>
                <td><strong>${(record.prob_repay * 100).toFixed(1)}%</strong></td>
                <td><span class="status-pill ${pillClass}">${record.rating}</span></td>
            `;
            tbody.appendChild(tr);
        });

        // Setup Charts
        const distCtx = document.getElementById('riskDistributionChart').getContext('2d');
        const scatterCtx = document.getElementById('incomeCreditRiskChart').getContext('2d');

        // Destroy previous chart instances
        if (distChartInstance) distChartInstance.destroy();
        if (scatterChartInstance) scatterChartInstance.destroy();

        // 1. Doughnut Chart for Risk Distribution
        distChartInstance = new Chart(distCtx, {
            type: 'doughnut',
            data: {
                labels: ['Low Risk', 'Moderate Risk', 'High Risk'],
                datasets: [{
                    data: [
                        data.summary.low_risk_count,
                        data.summary.medium_risk_count,
                        data.summary.high_risk_count
                    ],
                    backgroundColor: ['#10b981', '#f59e0b', '#ef4444'],
                    borderWidth: 1,
                    borderColor: 'rgba(255,255,255,0.05)'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 11 } }
                    }
                }
            }
        });

        // 2. Scatter Plot for Income vs Credit
        const scatterData = {
            low: [],
            medium: [],
            high: []
        };

        data.results.forEach(record => {
            const dataPoint = { x: record.income, y: record.credit };
            if (record.rating === 'Low Risk') scatterData.low.push(dataPoint);
            else if (record.rating === 'Moderate Risk') scatterData.medium.push(dataPoint);
            else scatterData.high.push(dataPoint);
        });

        scatterChartInstance = new Chart(scatterCtx, {
            type: 'scatter',
            data: {
                datasets: [
                    {
                        label: 'Low Risk',
                        data: scatterData.low.slice(0, 100), // Cap at 100 points for chart performance
                        backgroundColor: 'rgba(16, 185, 129, 0.75)',
                        pointRadius: 5
                    },
                    {
                        label: 'Moderate Risk',
                        data: scatterData.medium.slice(0, 100),
                        backgroundColor: 'rgba(245, 158, 11, 0.75)',
                        pointRadius: 5
                    },
                    {
                        label: 'High Risk',
                        data: scatterData.high.slice(0, 100),
                        backgroundColor: 'rgba(239, 68, 68, 0.75)',
                        pointRadius: 5
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        title: { display: true, text: 'Annual Income ($)', color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: '#9ca3af' }
                    },
                    y: {
                        title: { display: true, text: 'Requested Credit ($)', color: '#9ca3af' },
                        grid: { color: 'rgba(255,255,255,0.03)' },
                        ticks: { color: '#9ca3af' }
                    }
                },
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: '#9ca3af', font: { family: 'Plus Jakarta Sans', size: 11 } }
                    }
                }
            }
        });
    }

    // CSV Download Export Handler
    document.getElementById('btn-download-csv').addEventListener('click', () => {
        if (!batchResultsData || !batchResultsData.results) return;

        // Build CSV Content
        let csvContent = "Applicant_ID,Annual_Income,Requested_Credit,Default_Risk_Probability,Repayment_Probability,Risk_Rating\n";
        
        batchResultsData.results.forEach(record => {
            csvContent += `${record.id},${record.income},${record.credit},${record.prob_default.toFixed(6)},${record.prob_repay.toFixed(6)},${record.rating}\n`;
        });

        // Trigger Browser Download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `Vanguard_Risk_Report_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    });
});
