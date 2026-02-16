// State
const state = {
    user: JSON.parse(localStorage.getItem('bus_user')) || null,
    lines: [],
    availableLineCodes: [],
    groups: [],
    selectedGroupId: null,
    lastActions: [],
    lastDetailData: []
};

let currentAnalysisLine = null;
window.currentActionsLine = null;

// DOM Elements
const views = {
    login: document.getElementById('login-view'),
    dashboard: document.getElementById('dashboard-view')
};

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
    init();
});

function init() {
    const savedUser = localStorage.getItem('bus_user');

    // Set Default Dates (First day of current month to Today)
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

    if (document.getElementById('start-date')) {
        document.getElementById('start-date').valueAsDate = firstDay;
        document.getElementById('end-date').valueAsDate = today;
    }

    if (document.getElementById('impact-start-date')) {
        document.getElementById('impact-start-date').valueAsDate = firstDay;
        document.getElementById('impact-end-date').valueAsDate = today;
    }

    if (savedUser) {
        state.user = JSON.parse(savedUser);
        showDashboard();
        // Sync view with hash on load
        handleNavigation();
    } else {
        showLogin();
    }

    setupEventListeners();
}

function showLogin() {
    views.login.classList.remove('hidden');
    views.dashboard.classList.add('hidden');
}

function showDashboard() {
    views.login.classList.add('hidden');
    views.dashboard.classList.remove('hidden');
    document.getElementById('display-username').textContent = state.user.username;

    if (state.user.role === 'MASTER') {
        document.querySelectorAll('.master-only').forEach(el => el.classList.remove('hidden'));
    }

    fetchGroups();
    fetchLines();
}

function setupEventListeners() {
    // Auth
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', handleLogout);
    }

    // Filters
    const filterBtn = document.getElementById('btn-filter');
    if (filterBtn) {
        filterBtn.addEventListener('click', fetchLines);
    }

    const backBtn = document.getElementById('btn-back-groups');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            window.location.hash = 'operacional';
        });
    }

    // Modal Close
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.modal').forEach(m => m.classList.add('hidden'));
            document.body.classList.remove('modal-open');
        };
    });

    // Master Actions
    const groupBtn = document.getElementById('btn-manage-groups');
    if (groupBtn) {
        groupBtn.addEventListener('click', openGroupModal);
    }

    const createGroupBtn = document.getElementById('btn-create-group');
    if (createGroupBtn) {
        createGroupBtn.addEventListener('click', createGroup);
    }

    const backToListBtn = document.getElementById('btn-back-to-list');
    if (backToListBtn) {
        backToListBtn.onclick = () => switchGroupModalView('group-list-view');
    }

    const doneBtn = document.getElementById('btn-selection-done');
    if (doneBtn) {
        doneBtn.onclick = () => {
            switchGroupModalView('group-list-view');
            fetchGroups(); // Update the main dashboard with the new line memberships
        };
    }

    const selectionSearch = document.getElementById('search-selection-lines');
    if (selectionSearch) {
        selectionSearch.addEventListener('input', renderSelectionGrid);
    }

    // Unified Modal Logic
    const saveActionBtn = document.getElementById('btn-save-action');
    if (saveActionBtn) {
        saveActionBtn.onclick = handleSaveAction;
    }

    const uploadAnalysisBtn = document.getElementById('btn-upload-analysis');
    if (uploadAnalysisBtn) {
        uploadAnalysisBtn.onclick = handleAnalysisUpload;
    }

    setupAnalysisUI();

    // Setup Uploads
    setupUpload('csv-upload', '/api/import-csv');
    setupUpload('csv-predict', '/api/import-predicted');

    const exportBtn = document.getElementById('btn-export-group');
    if (exportBtn) {
        exportBtn.onclick = exportGroupToExcel;
    }

    // Default view: ONLY if no hash exists
    if (!window.location.hash) {
        switchMainTab('macro');
    }

    // Hash Navigation
    window.addEventListener('hashchange', handleNavigation);
}

function handleNavigation() {
    const hash = window.location.hash || '#macro';

    if (hash === '#macro') {
        applyView('macro');
        exitGroupUI(); // Hide operational tables if switching TO macro
    } else if (hash === '#operacional') {
        applyView('operacional');
        exitGroupUI();
    } else if (hash === '#impacto') {
        applyView('impacto');
        exitGroupUI();
    } else if (hash.startsWith('#group-')) {
        const groupId = parseInt(hash.split('-')[1]);
        const group = state.groups.find(g => g.id === groupId);
        if (group) {
            applyView('operacional');
            enterGroupUI(group);
        } else {
            // Group not found, fallback to operational list
            window.location.hash = '#operacional';
        }
    } else {
        // Fallback for unknown hashes
        window.location.hash = '#macro';
    }
}

function enterGroupUI(group) {
    state.selectedGroupId = group.id;
    const titleEl = document.getElementById('dashboard-title');
    if (titleEl) titleEl.textContent = `Bloco: ${group.name}`;

    const mainContent = document.getElementById('dashboard-main-content');
    const tableContainer = document.getElementById('data-table-container');
    const backBtn = document.getElementById('btn-back-groups');
    const exportBtn = document.getElementById('btn-export-group');

    if (mainContent) mainContent.classList.add('hidden');
    if (tableContainer) tableContainer.classList.remove('hidden');
    if (backBtn) backBtn.classList.remove('hidden');
    if (exportBtn) exportBtn.classList.remove('hidden');

    renderAggregatedTable();
}

function exitGroupUI() {
    state.selectedGroupId = null;
    const titleEl = document.getElementById('dashboard-title');

    // Title is set by applyView if we are just switching tabs, 
    // but if we are in Operational tab and just clearing group, we reset it.
    if (window.location.hash === '#operacional' && titleEl) {
        titleEl.textContent = 'Visão Geral da Operação';
    }

    const mainContent = document.getElementById('dashboard-main-content');
    const tableContainer = document.getElementById('data-table-container');
    const backBtn = document.getElementById('btn-back-groups');
    const exportBtn = document.getElementById('btn-export-group');

    if (mainContent) mainContent.classList.remove('hidden');
    if (tableContainer) tableContainer.classList.add('hidden');
    if (backBtn) backBtn.classList.add('hidden');
    if (exportBtn) exportBtn.classList.add('hidden');
}

// Data Actions
async function fetchLines() {
    const start = document.getElementById('start-date').value;
    const end = document.getElementById('end-date').value;

    try {
        const res = await fetch(`/api/lines?start=${start}&end=${end}`);
        state.lines = await res.json();

        renderGroups();
        renderMacroDashboard();

        if (state.selectedGroupId) {
            renderAggregatedTable();
        }
    } catch (err) {
        console.error('Error fetching lines:', err);
    }
}

let isExporting = false;
async function exportGroupToExcel(e) {
    if (e) e.preventDefault();
    if (isExporting || !state.selectedGroupId) return;

    const start = document.getElementById('start-date').value;
    const end = document.getElementById('end-date').value;

    if (!start || !end) {
        alert("Selecione um período válido.");
        return;
    }

    const groupName = state.groups.find(g => g.id === state.selectedGroupId)?.name || 'grupo';
    const exportBtn = document.getElementById('btn-export-group');

    isExporting = true;
    const originalContent = '<span>EXPORTAR EXCEL</span>';
    exportBtn.innerHTML = '<span>GERANDO EXCEL...</span>';
    exportBtn.disabled = true;
    exportBtn.style.opacity = '0.7';

    try {
        const url = `/api/export-group?group_id=${state.selectedGroupId}&start=${start}&end=${end}`;
        console.log("Exporting group Excel:", url);
        const response = await fetch(url);

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(errorText || 'Falha ao gerar Excel');
        }

        const blob = await response.blob();
        const downloadUrl = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = downloadUrl;
        a.download = `Export_${groupName}_${start}_${end}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        window.URL.revokeObjectURL(downloadUrl);
    } catch (err) {
        console.error(err);
        alert('Erro ao exportar Excel: ' + err.message);
    } finally {
        isExporting = false;
        if (exportBtn) {
            exportBtn.innerHTML = originalContent;
            exportBtn.disabled = false;
            exportBtn.style.opacity = '1';
        }
    }
}

function switchMainTab(tab) {
    if (tab === 'macro') window.location.hash = 'macro';
    else if (tab === 'operacional') window.location.hash = 'operacional';
    else if (tab === 'impacto') window.location.hash = 'impacto';
}

function applyView(tab) {
    const macroTab = document.getElementById('tab-macro');
    const operTab = document.getElementById('tab-operacional');
    const impactTab = document.getElementById('tab-impacto');
    const macroContent = document.getElementById('macro-tab-content');
    const operContent = document.getElementById('operational-tab-content');
    const impactContent = document.getElementById('impact-tab-content');
    const title = document.getElementById('dashboard-title');

    // Reset visibility
    [macroTab, operTab, impactTab].forEach(t => t?.classList.remove('active'));
    [macroContent, operContent, impactContent].forEach(c => c?.classList.add('hidden'));

    if (tab === 'macro') {
        macroTab.classList.add('active');
        macroContent.classList.remove('hidden');
        title.textContent = 'Panorama Macro';

        // Show global filter toolbar
        const globalToolbar = document.querySelector('.toolbar .actions .filter-group');
        if (globalToolbar) globalToolbar.style.display = 'flex';

        renderMacroDashboard();
    } else if (tab === 'operacional') {
        operTab?.classList.add('active');
        operContent?.classList.remove('hidden');
        title.textContent = 'Visão Geral da Operação';
        // Restore global toolbar if it was hidden
        const globalToolbar = document.querySelector('.toolbar .actions .filter-group');
        if (globalToolbar) globalToolbar.style.display = 'flex';
        renderGroups(); // Assuming renderGroups() is the equivalent of renderOperationalTable() for this context
    } else if (tab === 'impacto') {
        impactTab?.classList.add('active');
        impactContent?.classList.remove('hidden');
        title.textContent = 'Relatórios de Impacto';

        // Hide global filter toolbar if on Impact tab to avoid confusion
        const globalToolbar = document.querySelector('.toolbar .actions .filter-group');
        if (globalToolbar) globalToolbar.style.display = 'none';

        renderImpactPage();
    }
}

async function renderImpactPage() {
    const tbody = document.querySelector('#impact-report-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">Carregando histórico de impacto...</td></tr>';

    const start = document.getElementById('impact-start-date').value;
    const end = document.getElementById('impact-end-date').value;

    try {
        let url = '/api/global-actions-impact';
        const params = new URLSearchParams();
        if (start) params.append('start', start);
        if (end) params.append('end', end);
        if (params.toString()) url += `?${params.toString()}`;

        const response = await fetch(url);
        const data = await response.json();

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">Nenhuma ação registrada no sistema.</td></tr>';
            return;
        }

        // Summary Stats
        const totalActions = data.length;
        const positiveActions = data.filter(d => d.status === 'Melhorou').length;
        const totalSystemicImpact = data.reduce((acc, curr) => acc + curr.diff, 0).toFixed(0);

        const allPercents = data.map(d => d.percent);
        const avgVariation = allPercents.length > 0 ? (allPercents.reduce((a, b) => a + b, 0) / allPercents.length).toFixed(1) : 0;

        document.getElementById('impact-total-actions').textContent = totalActions;
        document.getElementById('impact-positive-actions').textContent = positiveActions;

        const avgImprovementEl = document.getElementById('impact-avg-improvement');
        if (avgImprovementEl) {
            avgImprovementEl.textContent = `${avgVariation > 0 ? '+' : ''}${avgVariation}%`;
            const card = avgImprovementEl.closest('.kpi-card');
            if (card) {
                card.classList.remove('success', 'danger');
                if (avgVariation > 2) card.classList.add('success');
                else if (avgVariation < -2) card.classList.add('danger');
            }
            // Update label too
            const labelEl = avgImprovementEl.previousElementSibling;
            if (labelEl && labelEl.classList.contains('label')) {
                labelEl.textContent = 'VARIAÇÃO MÉDIA';
            }
        }

        document.getElementById('impact-total-systemic').textContent = totalSystemicImpact;

        const systemicCard = document.getElementById('card-systemic-impact');
        if (systemicCard) {
            systemicCard.classList.remove('success', 'danger');
            if (totalSystemicImpact > 0) systemicCard.classList.add('success');
            else if (totalSystemicImpact < 0) systemicCard.classList.add('danger');
        }

        tbody.innerHTML = '';
        data.forEach(item => {
            const row = document.createElement('tr');

            let statusClass = 'label-stable';
            if (item.status === 'Melhorou') statusClass = 'label-success';
            if (item.status === 'Piorou') statusClass = 'label-danger';

            const impactClass = item.diff > 0 ? 'diff-positive' : (item.diff < 0 ? 'diff-negative' : '');

            row.onclick = () => openComparativeImpact(item.line_code, item.date, item.comment);
            row.style.cursor = 'pointer';
            row.title = "Clique para ver comparativo linha vs sistema";

            row.innerHTML = `
                <td><strong>${item.line_code}</strong></td>
                <td>${item.date}</td>
                <td style="font-size: 0.8rem;">${item.comment || 'Ação Operacional'}</td>
                <td>${item.avg_before}</td>
                <td>${item.avg_after}</td>
                <td class="${impactClass}"><strong>${item.diff}</strong> (${item.percent}%)</td>
                <td><span class="status-badge ${statusClass}">${item.status}</span></td>
            `;
            tbody.appendChild(row);
        });
    } catch (err) {
        console.error('Error rendering impact page:', err);
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px; color: #ef4444;">Erro ao carregar dados.</td></tr>';
    }
}

function renderMacroDashboard() {
    const data = state.lines || [];

    // Aggregation
    const companies = {};
    const dailyData = {};
    let totalPred = 0;
    let totalReal = 0;

    data.forEach(line => {
        const compName = line.company || 'Não Informada';
        const date = line.date;

        // Company Aggregation
        if (!companies[compName]) {
            companies[compName] = { pred: 0, real: 0, codes: new Set() };
        }
        companies[compName].pred += line.predicted_passengers || 0;
        companies[compName].real += line.realized_passengers || 0;
        companies[compName].codes.add(line.line_code);

        // Daily Aggregation
        if (!dailyData[date]) {
            dailyData[date] = { pred: 0, real: 0 };
        }
        dailyData[date].pred += line.predicted_passengers || 0;
        dailyData[date].real += line.realized_passengers || 0;

        totalPred += line.predicted_passengers || 0;
        totalReal += line.realized_passengers || 0;
    });

    // Render KPIs
    const diff = totalReal - totalPred;
    const perf = totalPred > 0 ? (totalReal / totalPred) * 100 : 0;

    document.getElementById('macro-total-predicted').textContent = Math.round(totalPred).toLocaleString();
    document.getElementById('macro-total-realized').textContent = Math.round(totalReal).toLocaleString();
    document.getElementById('macro-total-diff').textContent = (diff > 0 ? '+' : '') + Math.round(diff).toLocaleString();
    document.getElementById('macro-overall-perf').textContent = perf.toFixed(1) + '%';

    const diffEl = document.getElementById('macro-total-diff');
    diffEl.style.color = diff >= 0 ? 'var(--success)' : 'var(--danger)';

    // Render Chart
    renderMacroChart(dailyData);

    // Render Company Grid
    const grid = document.getElementById('macro-company-grid');
    grid.innerHTML = '';

    Object.entries(companies).sort((a, b) => b[1].real - a[1].real).forEach(([name, stats]) => {
        const cPerf = stats.pred > 0 ? (stats.real / stats.pred) * 100 : 0;
        const cDiff = stats.real - stats.pred;

        const card = document.createElement('div');
        card.className = 'glass-panel company-card';

        const perfColor = cPerf >= 95 ? 'var(--success)' : (cPerf >= 85 ? 'var(--warning)' : 'var(--danger)');

        card.innerHTML = `
            <div class="company-header">
                <h4>${name}</h4>
                <div class="perf-badge" style="background: ${perfColor}22; color: ${perfColor}">${cPerf.toFixed(1)}%</div>
            </div>
            <div class="company-stats">
                <span>Previsto: <strong>${Math.round(stats.pred).toLocaleString()}</strong></span>
                <span style="color: var(--success)">Realizado: <strong>${Math.round(stats.real).toLocaleString()}</strong></span>
            </div>
            <div class="progress-bg">
                <div class="progress-fill" style="width: ${Math.min(cPerf, 100)}%; background: ${perfColor}"></div>
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted); display:flex; justify-content: space-between;">
                <span>${stats.codes.size} Linhas Ativas</span>
                <span style="color: ${perfColor}">${cDiff > 0 ? '+' : ''}${Math.round(cDiff).toLocaleString()} Dif.</span>
            </div>
        `;
        grid.appendChild(card);

        // Add click listener for drilldown
        card.onclick = () => showCompanyDetail(name);
    });
}

function renderMacroChart(dailyData) {
    const ctx = document.getElementById('macro-performance-chart');
    if (!ctx) return;

    if (state.macroChart) {
        state.macroChart.destroy();
    }

    const sortedDates = Object.keys(dailyData).sort();
    const labels = sortedDates.map(d => {
        const parts = d.split('-');
        return `${parts[2]}/${parts[1]}`;
    });
    const predData = sortedDates.map(d => Math.round(dailyData[d].pred));
    const realData = sortedDates.map(d => Math.round(dailyData[d].real));

    state.macroChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Previsto',
                    data: predData,
                    borderColor: '#3b82f6',
                    backgroundColor: '#3b82f622',
                    borderWidth: 2,
                    pointRadius: 3,
                    fill: true,
                    tension: 0.3
                },
                {
                    label: 'Realizado',
                    data: realData,
                    borderColor: '#10b981',
                    backgroundColor: 'transparent',
                    borderWidth: 2,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981',
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#cbd5e1', font: { size: 11 } }
                },
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                },
                y: {
                    beginAtZero: true,
                    ticks: { color: '#64748b', font: { size: 10 } },
                    grid: { color: 'rgba(255,255,255,0.05)' }
                }
            }
        }
    });
}

function showCompanyDetail(companyName) {
    const data = state.lines || [];
    const companyGrid = document.getElementById('macro-company-grid');
    const companyDetail = document.getElementById('macro-company-detail');
    const detailTitle = document.getElementById('macro-detail-company-name');
    const tbody = document.querySelector('#macro-detail-table tbody');

    // Aggregate by line code for this specific company
    const lines = {};
    data.filter(l => (l.company || 'Não Informada') === companyName).forEach(l => {
        if (!lines[l.line_code]) {
            lines[l.line_code] = {
                line_code: l.line_code,
                line_name: l.line_name || 'N/A',
                pred: 0,
                real: 0
            };
        }
        lines[l.line_code].pred += l.predicted_passengers || 0;
        lines[l.line_code].real += l.realized_passengers || 0;
    });

    // Render Table
    tbody.innerHTML = '';
    const sortedLines = Object.values(lines).sort((a, b) => b.real - a.real);

    sortedLines.forEach(l => {
        const lPerf = l.pred > 0 ? (l.real / l.pred) * 100 : 0;
        const lDiff = l.real - l.pred;
        const diffClass = lDiff >= 0 ? 'diff-positive' : 'diff-negative';

        const row = document.createElement('tr');
        row.innerHTML = `
            <td><strong>${l.line_code}</strong></td>
            <td><small>${l.line_name}</small></td>
            <td>${Math.round(l.pred).toLocaleString()}</td>
            <td>${Math.round(l.real).toLocaleString()}</td>
            <td class="${diffClass}">${lDiff > 0 ? '+' : ''}${Math.round(lDiff).toLocaleString()}</td>
            <td class="${diffClass}">${lPerf.toFixed(1)}%</td>
        `;
        tbody.appendChild(row);
    });

    // Toggle View
    detailTitle.textContent = `Desempenho: ${companyName}`;
    companyGrid.classList.add('hidden');
    companyDetail.classList.remove('hidden');
}

async function fetchGroups() {
    try {
        const res = await fetch('/api/groups');
        state.groups = await res.json();
        renderGroups();
        handleNavigation();
    } catch (err) {
        console.error('Failed to fetch groups', err);
    }
}

function renderGroups() {
    const container = document.getElementById('groups-container');
    if (!container) return;
    container.innerHTML = '';

    state.groups.forEach(group => {
        const card = document.createElement('div');
        card.className = 'group-card';
        card.innerHTML = `
            <h3>${group.name}</h3>
            <p class="stats">${group.lines.length} linhas vinculadas</p>
        `;
        card.onclick = () => filterByGroup(group);
        container.appendChild(card);
    });

    renderDashboardSummary();
}

function renderDashboardSummary() {
    const topTbody = document.querySelector('#top-lines-table tbody');
    const bottomTbody = document.querySelector('#bottom-lines-table tbody');
    if (!topTbody || !bottomTbody) return;

    topTbody.innerHTML = '';
    bottomTbody.innerHTML = '';

    // 1. Map line to group names
    const lineToGroup = {};
    state.groups.forEach(g => {
        g.lines.forEach(lineCode => {
            lineToGroup[lineCode] = g.name;
        });
    });

    // 2. Aggregate all data across all lines
    const aggregated = {};
    state.lines.forEach(line => {
        if (!aggregated[line.line_code]) {
            aggregated[line.line_code] = { line_code: line.line_code, predicted: 0, realized: 0 };
        }
        aggregated[line.line_code].predicted += (line.predicted_passengers || 0);
        aggregated[line.line_code].realized += (line.realized_passengers || 0);
    });

    // 3. Calculate % Performance and filter out zero-diff lines
    const rankings = Object.values(aggregated).map(line => {
        const diff = line.realized - line.predicted;
        const percent = line.predicted > 0 ? (line.realized / line.predicted) * 100 : 0;
        return {
            ...line,
            diff,
            percent,
            groupName: lineToGroup[line.line_code] || 'Sem Bloco'
        };
    }).filter(item => item.diff !== 0);

    // 4. Sort by absolute difference (Numerical Volume)
    const top5 = [...rankings].filter(item => item.diff > 0).sort((a, b) => b.diff - a.diff).slice(0, 5);
    const bottom5 = [...rankings].filter(item => item.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 5);

    const renderRows = (data, tbody) => {
        data.forEach(item => {
            const diffClass = item.diff < 0 ? 'diff-negative' : 'diff-positive';
            const row = document.createElement('tr');
            row.innerHTML = `
                <td><strong>${item.line_code}</strong></td>
                <td><small>${item.groupName}</small></td>
                <td>${item.predicted.toLocaleString()}</td>
                <td>${item.realized.toLocaleString()}</td>
                <td class="${diffClass}">${item.diff > 0 ? '+' : ''}${item.diff.toLocaleString()}</td>
                <td class="${diffClass} diff-tag">${item.percent.toFixed(1)}%</td>
            `;
            tbody.appendChild(row);
        });
    };

    renderRows(top5, topTbody);
    renderRows(bottom5, bottomTbody);
}

function filterByGroup(group) {
    window.location.hash = `group-${group.id}`;
}

function renderAggregatedTable() {
    const tbody = document.querySelector('#lines-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let filteredData = state.lines;
    if (state.selectedGroupId) {
        const group = state.groups.find(g => g.id === state.selectedGroupId);
        if (group) {
            filteredData = state.lines.filter(l => group.lines.includes(l.line_code));
        }
    }

    const aggregated = {};
    filteredData.forEach(line => {
        if (!aggregated[line.line_code]) {
            aggregated[line.line_code] = {
                line_code: line.line_code,
                company: new Set(),
                predicted: 0,
                realized: 0
            };
        }
        aggregated[line.line_code].predicted += (line.predicted_passengers || 0);
        aggregated[line.line_code].realized += (line.realized_passengers || 0);
        if (line.company) {
            line.company.split(' / ').forEach(c => {
                if (c.trim()) aggregated[line.line_code].company.add(c.trim());
            });
        }
    });

    const sortedLines = Object.values(aggregated).sort((a, b) => a.line_code.localeCompare(b.line_code));

    sortedLines.forEach(line => {
        const diff = line.realized - line.predicted;
        const percent = line.predicted !== 0 ? (line.realized / line.predicted) * 100 : 0;
        const diffClass = diff > 0 ? 'diff-positive' : (diff < 0 ? 'diff-negative' : '');

        const row = document.createElement('tr');
        const companyText = Array.from(line.company).join(' / ') || '-';
        row.innerHTML = `
            <td><strong>${line.line_code}</strong></td>
            <td><small>${companyText}</small></td>
            <td>${Math.round(line.predicted).toLocaleString()}</td>
            <td>${Math.round(line.realized).toLocaleString()}</td>
            <td class="${diffClass}">${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString()} (${percent.toFixed(1)}%)</td>
            <td>
                <div style="display: flex; gap: 5px;">
                    <button class="btn primary small" onclick="openLineDetail('${line.line_code}')">Detalhes</button>
                    <button class="btn accent small" onclick="openUnifiedModal('${line.line_code}')">Análise</button>
                </div>
            </td>
        `;
        tbody.appendChild(row);
    });
}

// --- Unified Analysis & Actions ---
async function openUnifiedModal(lineCode) {
    window.currentActionsLine = lineCode;
    window.currentAnalysisLine = lineCode;

    document.getElementById('unified-line-code').textContent = lineCode;
    document.getElementById('unified-modal').classList.remove('hidden');
    document.body.classList.add('modal-open');

    // Reset to history view by default
    switchModalView('history');

    // Clear inputs
    document.getElementById('analysis-desc').value = '';
    document.getElementById('analysis-file').value = '';
    document.getElementById('action-comment').value = '';
    document.getElementById('action-date').valueAsDate = new Date();

    // Clear actions list to avoid stale data
    const actionList = document.getElementById('actions-list');
    if (actionList) actionList.innerHTML = '<p class="text-muted" style="font-size: 0.8rem;">Carregando...</p>';

    // Fetch both histories in parallel
    await Promise.all([
        fetchAnalysisHistory(lineCode),
        fetchActionsHistory(lineCode)
    ]);
}

function closeUnifiedModal() {
    document.getElementById('unified-modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

async function fetchAnalysisHistory(lineCode) {
    const list = document.getElementById('analysis-list');
    list.innerHTML = '<p class="text-muted" style="font-size: 0.8rem;">Carregando...</p>';

    try {
        const res = await fetch(`/api/analysis?line_code=${lineCode}`);
        const data = await res.json();

        if (data.length === 0) {
            list.innerHTML = '<p class="text-muted" style="font-size: 0.8rem;">Nenhum arquivo anexado.</p>';
            return;
        }

        list.innerHTML = '';
        data.forEach(item => {
            const div = document.createElement('div');
            div.className = 'analysis-item';

            const dateStr = new Date(item.created_at).toLocaleString('pt-BR');

            const isMaster = state.user && state.user.role === 'MASTER';
            const deleteBtn = isMaster ? `<button class="btn-delete-analysis" onclick="deleteAnalysis(${item.id})" title="Excluir Registro">Excluir</button>` : '';

            div.innerHTML = `
                <div class="analysis-info">
                    <span class="analysis-fn">${item.original_filename}</span>
                    <span class="analysis-desc">${item.description || 'Sem descrição'}</span>
                    <span class="analysis-meta">${dateStr}</span>
                </div>
                <div class="analysis-actions">
                    <a href="/api/analysis/download?id=${item.id}" target="_blank" class="btn-download-link">Baixar</a>
                    ${deleteBtn}
                </div>
            `;
            list.appendChild(div);
        });
    } catch (err) {
        console.error(err);
        list.innerHTML = '<p class="text-danger">Erro ao carregar histórico.</p>';
    }
}

async function handleAnalysisUpload() {
    const fileInput = document.getElementById('analysis-file');
    const descInput = document.getElementById('analysis-desc');

    if (!fileInput.files[0]) {
        alert('Por favor, selecione um arquivo.');
        return;
    }

    const formData = new FormData();
    formData.append('line_code', window.currentAnalysisLine);
    formData.append('description', descInput.value);
    formData.append('file', fileInput.files[0]);
    formData.append('author_id', state.user ? state.user.id : 0);

    const btn = document.getElementById('btn-upload-analysis');
    const originalText = btn.textContent;
    btn.textContent = 'Enviando...';
    btn.disabled = true;

    try {
        const res = await fetch('/api/analysis', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            alert('Análise enviada com sucesso!');
            descInput.value = '';
            fileInput.value = '';
            const labelText = document.querySelector('.file-label-text');
            if (labelText) labelText.textContent = 'Anexar Arquivo';
            await fetchAnalysisHistory(window.currentAnalysisLine);
        } else {
            const err = await res.text();
            alert('Erro no envio: ' + err);
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão ao enviar arquivo.');
    } finally {
        btn.textContent = originalText;
        btn.disabled = false;
    }
}

async function deleteAnalysis(id) {
    if (!confirm('Deseja realmente excluir este registro e o arquivo associado? Esta ação é irreversível.')) {
        return;
    }

    try {
        const res = await fetch(`/api/analysis?id=${id}&userId=${state.user.id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            alert('Registro excluído com sucesso.');
            await fetchAnalysisHistory(window.currentAnalysisLine);
        } else {
            const err = await res.text();
            alert('Erro ao excluir: ' + err);
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão ao excluir registro.');
    }
}

// Helper to show filename in custom label
function setupAnalysisUI() {
    const fileInput = document.getElementById('analysis-file');
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            const labelText = document.querySelector('.file-label-text');
            if (labelText && e.target.files[0]) {
                labelText.textContent = `Arquivo: ${e.target.files[0].name}`;
                labelText.style.color = '#3b82f6';
            }
        });
    }
}




async function fetchActionsHistory(lineCode, quiet = false) {
    const list = document.getElementById('actions-list');
    if (!quiet) list.innerHTML = '<p class="text-muted" style="font-size: 0.8rem;">Carregando...</p>';

    try {
        const res = await fetch(`/api/line-actions?line_code=${lineCode}`);
        const data = await res.json();

        state.lastActions = data;

        // Populate the dropdown in Impact View if it exists
        populateImpactActionsSelect(data);

        if (list) {
            if (data.length === 0) {
                list.innerHTML = '<p class="text-muted" style="font-size: 0.8rem;">Nenhum comentário registrado.</p>';
                return;
            }

            list.innerHTML = '';
            data.forEach(item => {
                const div = document.createElement('div');
                div.className = 'analysis-item'; // Reuse same styles

                const dateStr = item.implementation_date
                    ? new Date(item.implementation_date + 'T00:00:00').toLocaleDateString('pt-BR')
                    : 'Sem data';
                const createdStr = new Date(item.created_at).toLocaleString('pt-BR');

                const isMaster = state.user && state.user.role === 'MASTER';
                const deleteBtn = isMaster ? `<button class="btn-delete-analysis" onclick="deleteAction(${item.id})" title="Excluir">Excluir</button>` : '';

                div.innerHTML = `
                    <div class="analysis-info">
                        <span class="analysis-fn" style="color: var(--primary-color)">Implementação: ${dateStr}</span>
                        <span class="analysis-desc">${item.comment}</span>
                        <span class="analysis-meta">Registrado em ${createdStr}</span>
                    </div>
                    <div class="analysis-actions">
                        <button class="btn-download-link" style="background: rgba(59, 130, 246, 0.1); color: #60a5fa;" 
                            onclick="window.prepareImpactModal('${item.id}')" title="Ver Impacto">
                            VER IMPACTO
                        </button>
                        ${deleteBtn}
                    </div>
                `;
                list.appendChild(div);
            });
        }
    } catch (err) {
        console.error(err);
        if (!quiet) list.innerHTML = '<p class="text-danger">Erro ao carregar histórico.</p>';
    }
}

async function handleSaveAction() {
    const commentInput = document.getElementById('action-comment');
    const dateInput = document.getElementById('action-date');

    const comment = commentInput.value.trim();
    if (!comment) {
        alert('Por favor, escreva um comentário.');
        return;
    }

    if (!window.currentActionsLine) {
        alert('Erro: Linha não identificada. Por favor, feche e abra o modal novamente.');
        return;
    }

    const payload = {
        line_code: window.currentActionsLine,
        comment: comment,
        implementation_date: dateInput.value,
        author_id: state.user ? state.user.id : 0
    };

    const btn = document.getElementById('btn-save-action');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        const res = await fetch('/api/line-actions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            commentInput.value = '';
            await fetchActionsHistory(window.currentActionsLine);
        } else {
            alert('Erro ao salvar comentário.');
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão ao salvar.');
    } finally {
        btn.disabled = false;
        btn.textContent = 'SALVAR AÇÃO';
    }
}

async function deleteAction(id) {
    if (!confirm('Deseja excluir este comentário?')) return;

    try {
        const res = await fetch(`/api/line-actions?id=${id}&userId=${state.user.id}`, {
            method: 'DELETE'
        });
        if (res.ok) {
            await fetchActionsHistory(window.currentActionsLine);
        } else {
            alert('Erro ao excluir');
        }
    } catch (err) {
        alert('Erro de conexão');
    }
}

// Group Management Interface
function openGroupModal() {
    document.getElementById('group-modal').classList.remove('hidden');
    document.body.classList.add('modal-open');
    switchGroupModalView('group-list-view');
    renderManagementGroups();
}

function switchGroupModalView(viewId) {
    document.querySelectorAll('.group-manager-view').forEach(v => v.classList.add('hidden'));
    document.getElementById(viewId).classList.remove('hidden');
}

function renderManagementGroups() {
    const list = document.getElementById('manage-groups-list');
    list.innerHTML = '';
    state.groups.sort((a, b) => a.name.localeCompare(b.name)).forEach(g => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span><strong>${g.name}</strong> (${g.lines.length} linhas)</span>
            <div class="li-actions">
                <button class="btn secondary small" onclick="openSelectionGrid(${g.id})">Editar Linhas</button>
                <button class="btn danger small" onclick="deleteGroup(${g.id})">Excluir</button>
            </div>
        `;
        list.appendChild(li);
    });
}

let editingGroupId = null;
async function openSelectionGrid(groupId) {
    editingGroupId = groupId;
    const group = state.groups.find(g => g.id === groupId);
    document.getElementById('editing-group-name').textContent = `Editando: ${group.name}`;

    switchGroupModalView('line-selection-view');

    if (state.availableLineCodes.length === 0) {
        await fetchAvailableLines();
    }
    renderSelectionGrid();
}

async function fetchAvailableLines() {
    try {
        const res = await fetch('/api/available-lines');
        state.availableLineCodes = await res.json();
    } catch (err) {
        console.error('Failed to fetch available lines', err);
    }
}

function renderSelectionGrid() {
    const grid = document.getElementById('selection-grid');
    if (!grid) return;
    grid.innerHTML = '';

    const searchTerm = document.getElementById('search-selection-lines').value.toLowerCase();
    const activeGroup = state.groups.find(g => g.id === editingGroupId);

    const filtered = state.availableLineCodes.filter(code => {
        return !searchTerm || code.toLowerCase().includes(searchTerm);
    });

    filtered.forEach(code => {
        // Find if this line belongs to ANY group
        const ownerGroup = state.groups.find(g => g.lines.includes(code));
        const isSelectedByActive = activeGroup && activeGroup.lines.includes(code);
        const isTakenByOther = ownerGroup && ownerGroup.id !== editingGroupId;

        const item = document.createElement('div');
        item.className = `selection-item ${isSelectedByActive ? 'checked' : ''} ${isTakenByOther ? 'taken' : ''}`;

        if (isTakenByOther) {
            item.innerHTML = `
                <div class="line-info">
                    <strong>${code}</strong>
                    <small class="taken-label">Bloco: ${ownerGroup.name}</small>
                </div>
            `;
            // Taken items are not clickable
        } else {
            item.innerHTML = `
                <input type="checkbox" ${isSelectedByActive ? 'checked' : ''} onchange="toggleLineInGroup(this, '${code}')">
                <span>${code}</span>
            `;
            // Make whole item clickable for non-taken lines
            item.onclick = (e) => {
                if (e.target.tagName !== 'INPUT') {
                    const cb = item.querySelector('input');
                    cb.checked = !cb.checked;
                    cb.dispatchEvent(new Event('change'));
                }
            };
        }
        grid.appendChild(item);
    });
}

async function toggleLineInGroup(checkbox, lineCode) {
    const action = checkbox.checked ? 'add' : 'remove';
    const item = checkbox.closest('.selection-item');
    item.classList.toggle('checked', checkbox.checked);

    try {
        const res = await fetch('/api/groups/members', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: editingGroupId, lineCode, action })
        });
        if (res.ok) {
            await fetchGroups();
            renderSelectionGrid(); // Update taken/owner status in the UI
        } else {
            checkbox.checked = !checkbox.checked; // revert
            item.classList.toggle('checked', checkbox.checked);
            alert('Erro ao atualizar grupo');
        }
    } catch (err) {
        console.error(err);
        checkbox.checked = !checkbox.checked;
        item.classList.toggle('checked', checkbox.checked);
    }
}

async function createGroup() {
    const nameInput = document.getElementById('new-group-name');
    const name = nameInput.value;
    if (!name) return;
    try {
        const res = await fetch('/api/groups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (res.ok) {
            nameInput.value = '';
            await fetchGroups();
            renderManagementGroups();
        }
    } catch (err) { console.error(err); }
}

async function deleteGroup(id) {
    if (!confirm('Deseja excluir este bloco permanentemente?')) return;
    try {
        const res = await fetch('/api/groups', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ groupId: id })
        });
        if (res.ok) {
            await fetchGroups();
            renderManagementGroups();
            if (state.selectedGroupId === id) {
                state.selectedGroupId = null; // Deselect if the deleted group was active
                document.getElementById('data-table-container').classList.add('hidden');
                document.getElementById('groups-container').classList.remove('hidden');
                document.getElementById('btn-back-groups').classList.add('hidden');
            }
        } else {
            alert('Erro ao excluir grupo');
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão ao excluir grupo');
    }
}

async function handleClearData() {
    if (!state.user || state.user.role !== 'MASTER') {
        alert('Acesso negado.');
        return;
    }

    const confirm1 = confirm('ATENÇÃO: Isso apagará TODOS os dados de realizados e previstos da tabela principal. Deseja continuar?');
    if (!confirm1) return;

    const confirm2 = confirm('TEM CERTEZA? Esta ação não pode ser desfeita e você precisará re-importar os arquivos CSV.');
    if (!confirm2) return;

    try {
        const res = await fetch('/api/clear-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: state.user.id })
        });

        if (res.ok) {
            alert('Dados apagados com sucesso!');
            fetchLines(); // Refresh UI
        } else {
            const err = await res.text();
            alert('Erro ao apagar: ' + err);
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão ao limpar dados.');
    }
}

let impactChart = null;
let detailChart = null;
let currentImpactState = {
    lineCode: null,
    baseDate: null,
    window: 7,
    comment: ''
};

let currentDetailState = {
    lineCode: null,
    start: null,
    end: null,
    dayOfWeek: 'all'
};

let currentComparativeState = {
    lineCode: null,
    baseDate: null,
    comment: ''
};

let compLineChart = null;
let compSystemChart = null;

// Helper to strictly sync tabs visibility
function syncModalTabs(activeView) {
    const impactTab = document.getElementById('tab-btn-impact');
    const compTab = document.getElementById('tab-btn-comparative');
    const detailTab = document.getElementById('tab-btn-detail');
    const historyTab = document.getElementById('tab-btn-history');

    // Default: Hide special tabs
    if (impactTab) impactTab.classList.add('hidden');
    if (compTab) compTab.classList.add('hidden');

    // Show only if active view matches
    if (activeView === 'impact' && impactTab) impactTab.classList.remove('hidden');
    if (activeView === 'comparative' && compTab) compTab.classList.remove('hidden');

    // Manage active states
    const allTabs = [impactTab, compTab, detailTab, historyTab].filter(t => t);
    allTabs.forEach(t => t.classList.remove('active'));

    const activeTabMap = {
        'impact': impactTab,
        'comparative': compTab,
        'detail': detailTab,
        'history': historyTab
    };

    const targetTab = activeTabMap[activeView];
    if (targetTab) targetTab.classList.add('active');
}

// View switching logic
function switchModalView(view) {
    const historyView = document.getElementById('modal-history-view');
    const impactView = document.getElementById('modal-impact-view');
    const detailView = document.getElementById('modal-detail-view');
    const comparativeView = document.getElementById('modal-comparative-view');

    // Sync tabs first
    syncModalTabs(view);

    [historyView, impactView, detailView, comparativeView].forEach(v => {
        if (v) v.classList.add('hidden');
    });

    if (view === 'impact') {
        if (impactView) impactView.classList.remove('hidden');
        if (currentImpactState.lineCode && currentImpactState.baseDate) {
            fetchAndRenderImpact();
        }
    } else if (view === 'comparative') {
        if (comparativeView) comparativeView.classList.remove('hidden');
    } else if (view === 'detail') {
        if (detailView) detailView.classList.remove('hidden');
    } else {
        if (historyView) historyView.classList.remove('hidden');
    }
}

function openImpactModal(lineCode, baseDate, comment, actionId = null) {
    console.log('DEBUG: openImpactModal called with:', { lineCode, baseDate, comment, actionId });
    if (!baseDate || baseDate === 'null') {
        alert('Esta ação não possui uma data de implementação para cálculo.');
        return;
    }

    try {
        // Sync the dropdown if an ID was provided
        if (actionId) {
            const select = document.getElementById('impact-action-select');
            if (select) select.value = actionId;
        }

        // Default After period: starts at baseDate, ends 6 days later (making it exactly 7 days)
        const startVal = baseDate;
        const actionDate = new Date(baseDate + 'T00:00:00');
        const defaultEnd = new Date(actionDate);
        defaultEnd.setDate(defaultEnd.getDate() + 6);
        const endVal = defaultEnd.toISOString().split('T')[0];

        document.getElementById('impact-date-start').value = startVal;
        document.getElementById('impact-date-end').value = endVal;

        currentImpactState = {
            lineCode,
            baseDate: startVal,
            window: 7,
            comment,
            actionId: actionId // Store ID to prevent sync issues
        };

        // Load conclusion if exists
        const actionItem = state.lastActions.find(a => a.id == actionId || (a.line_code === lineCode && a.implementation_date === baseDate && a.comment === comment));
        const conclusionInput = document.getElementById('impact-conclusion-input');
        if (conclusionInput) {
            conclusionInput.value = (actionItem && actionItem.impact_conclusion) ? actionItem.impact_conclusion : '';
        }

        document.getElementById('impact-line-title').innerText = lineCode;
        document.getElementById('impact-base-date').innerText = new Date(baseDate + 'T00:00:00').toLocaleDateString('pt-BR');
        document.getElementById('impact-action-desc').innerText = comment;

        switchModalView('impact');
    } catch (err) {
        console.error('CRITICAL ERROR in openImpactModal:', err);
        alert('Erro ao abrir análise de impacto: ' + err.message);
    }
}

async function saveImpactConclusion() {
    const select = document.getElementById('impact-action-select');
    const actionId = select.value;
    const conclusion = document.getElementById('impact-conclusion-input').value;

    if (!actionId) {
        alert("Selecione uma ação válida para salvar a conclusão.");
        return;
    }

    try {
        const res = await fetch('/api/update-action-conclusion', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: actionId, conclusion })
        });

        if (res.ok) {
            const action = state.lastActions.find(a => a.id == actionId);
            if (action) action.impact_conclusion = conclusion;
            alert("Conclusão salva com sucesso!");
        } else {
            const err = await res.text();
            throw new Error(`Erro: ${err}`);
        }
    } catch (err) {
        console.error(err);
        alert('Erro ao salvar conclusão: ' + err.message);
    }
}

function handleImpactDateChange() {
    // Optional: add visual cues if dates are invalid
}

function applyImpactDates() {
    console.log('DEBUG: applyImpactDates triggered');
    const startStr = document.getElementById('impact-date-start').value;
    const endStr = document.getElementById('impact-date-end').value;

    if (!startStr || !endStr) {
        alert('Por favor, selecione as datas de início e fim para o período POS-AÇÃO.');
        return;
    }

    const start = new Date(startStr + 'T00:00:00');
    const end = new Date(endStr + 'T00:00:00');

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        alert('As datas informadas são inválidas.');
        return;
    }

    if (end < start) {
        alert('A data final deve ser igual ou posterior à inicial.');
        return;
    }

    const diffDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24)) + 1;
    console.log('DEBUG: Updating impact state with window:', diffDays);

    currentImpactState.baseDate = startStr;
    currentImpactState.window = diffDays;

    fetchAndRenderImpact();
}

async function fetchAndRenderImpact() {
    const { lineCode, baseDate, window: win } = currentImpactState;
    if (!lineCode || !baseDate) return;

    const loadingEl = document.getElementById('impact-loading');
    if (loadingEl) loadingEl.classList.remove('hidden');

    try {
        const res = await fetch(`/api/action-impact?line_code=${lineCode}&base_date=${baseDate}&window=${win}`);
        const data = await res.json();

        // Batch DOM updates
        requestAnimationFrame(() => {
            try {
                renderImpactSummary(data);
                renderImpactChart(data);
                renderImpactTable(data);
            } catch (renderErr) {
                console.error('Error during impact render:', renderErr);
            } finally {
                if (loadingEl) loadingEl.classList.add('hidden');
            }
        });

    } catch (err) {
        console.error('Error fetching impact data:', err);
        if (loadingEl) loadingEl.classList.add('hidden');
        alert('Erro ao carregar dados de impacto.');
    }
}

function renderImpactSummary(data) {
    const avgBefore = data.avg_before || 0;
    const avgAfter = data.avg_after || 0;
    const delta = avgAfter - avgBefore;
    const perc = avgBefore !== 0 ? (delta / avgBefore * 100) : 0;

    document.getElementById('impact-avg-before').innerText = avgBefore.toFixed(1);
    document.getElementById('impact-avg-after').innerText = avgAfter.toFixed(1);

    const deltaEl = document.getElementById('impact-delta');
    deltaEl.innerText = `${delta > 0 ? '+' : ''}${delta.toFixed(1)} (${perc.toFixed(1)}%)`;
    deltaEl.className = `value ${delta > 0 ? 'diff-positive' : (delta < 0 ? 'diff-negative' : '')}`;
}

function renderImpactChart(data) {
    const ctx = document.getElementById('impactChart').getContext('2d');

    if (impactChart) impactChart.destroy();

    // Create mapping for tooltips
    const beforeDataMap = data.before;
    const afterDataMap = data.after;

    const labels = data.before.map((d, i) => {
        const date = new Date(d.date + 'T00:00:00');
        const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' });
        const shortDate = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        return `${weekday} (${shortDate})`;
    });

    impactChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Período ANTES',
                    data: data.before.map(d => d.val),
                    borderColor: '#f97316',
                    backgroundColor: 'rgba(249, 115, 22, 0.1)',
                    borderWidth: 2,
                    borderDash: [5, 5],
                    fill: true,
                    tension: 0.3,
                    pointRadius: 2
                },
                {
                    label: 'Período DEPOIS',
                    data: data.after.map(d => d.val),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false, // Instant render
            plugins: {
                legend: {
                    position: 'top',
                    labels: { color: '#94a3b8', font: { size: 11 } }
                },
                tooltip: {
                    backgroundColor: 'rgba(15, 23, 42, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#cbd5e1',
                    borderColor: 'rgba(59, 130, 246, 0.3)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        title: (tooltipItems) => {
                            const idx = tooltipItems[0].dataIndex;
                            const dsIdx = tooltipItems[0].datasetIndex;
                            const d = dsIdx === 0 ? beforeDataMap[idx] : afterDataMap[idx];
                            if (d && d.date) {
                                return new Date(d.date + 'T00:00:00').toLocaleDateString('pt-BR');
                            }
                            return `DIA ${idx + 1} DE COMPARAÇÃO`;
                        },
                        label: (context) => {
                            const i = context.dataIndex;
                            const b = beforeDataMap[i];
                            const a = afterDataMap[i] || { val: 0, date: '' };
                            const diff = a.val - b.val;
                            const perc = b.val !== 0 ? (diff / b.val * 100).toFixed(1) : '0';

                            const dateB = new Date(b.date + 'T00:00:00').toLocaleDateString('pt-BR');
                            const dateA = new Date(a.date + 'T00:00:00').toLocaleDateString('pt-BR');

                            const lines = [
                                `• ANTES: ${Math.round(b.val).toLocaleString('pt-BR')} (${dateB})`,
                                `• DEPOIS: ${Math.round(a.val).toLocaleString('pt-BR')} (${dateA})`,
                                `──────────────────`,
                                `• IMPACTO: ${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString('pt-BR')} (${diff > 0 ? '+' : ''}${perc}%)`
                            ];
                            return lines;
                        }
                    }
                }
            },
            scales: {
                x: {
                    ticks: { color: '#64748b', font: { size: 9 } },
                    grid: { display: false }
                },
                y: {
                    ticks: { color: '#64748b', font: { size: 9 } },
                    grid: { color: 'rgba(255,255,255,0.03)' }
                }
            }
        }
    });
}

function renderImpactTable(data) {
    const tbody = document.querySelector('#impact-detail-table tbody');
    tbody.innerHTML = '';

    data.before.forEach((itemB, i) => {
        const itemA = data.after[i] || { val: 0, date: '' };
        const diff = itemA.val - itemB.val;
        const perc = itemB.val !== 0 ? (diff / itemB.val * 100) : 0;
        const cls = diff > 0 ? 'diff-positive' : (diff < 0 ? 'diff-negative' : '');

        // Use more descriptive date label for the row
        const dateObjA = new Date(itemA.date + 'T00:00:00');
        const weekdayA = dateObjA.toLocaleDateString('pt-BR', { weekday: 'short' });
        const labelA = dateObjA.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td style="text-transform: capitalize; color: var(--text-muted); font-size: 0.7rem;">
                ${labelA} (${weekdayA})
            </td>
            <td style="font-weight: 500; font-size: 0.85rem;">${Math.round(itemB.val).toLocaleString('pt-BR')}</td>
            <td style="font-weight: 600; font-size: 0.85rem; color: #fff;">${Math.round(itemA.val).toLocaleString('pt-BR')}</td>
            <td class="${cls}" style="font-weight: 700; font-size: 0.85rem;">
                ${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString('pt-BR')}
            </td>
            <td class="${cls}" style="font-weight: 700; font-size: 0.85rem; text-align: right;">
                ${diff > 0 ? '+' : ''}${perc.toFixed(1)}%
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// Helper to prepare modal without escaping issues
// Helper to prepare modal without escaping issues
function prepareImpactModal(id) {
    console.log('DEBUG: prepareImpactModal called with id:', id);
    console.log('DEBUG: Current state.lastActions:', state.lastActions);

    // Ensure state.lastActions is an array
    if (!Array.isArray(state.lastActions)) {
        console.error('DEBUG: state.lastActions is NOT an array!');
        return;
    }

    const item = state.lastActions.find(a => a.id == id);
    if (item) {
        console.log('DEBUG: Action found:', item);
        openImpactModal(item.line_code, item.implementation_date, item.comment, item.id);
    } else {
        console.error(`DEBUG: prepareImpactModal - item NOT found for id: ${id}. Actions available:`, state.lastActions.map(a => a.id));
        alert('Erro interno: Detalhes da ação não encontrados. Tente recarregar a página.');
    }
}

// --- Line Detail View Logic ---

async function openComparativeImpact(lineCode, baseDate, comment) {
    if (!baseDate || baseDate === 'null') {
        alert('Esta ação não possui uma data de implementação para cálculo comparativo.');
        return;
    }

    // 1. Prepare Modal & Show and Switch to comparative view
    const unifiedModal = document.getElementById('unified-modal');
    if (!unifiedModal) return;

    document.getElementById('unified-line-code').textContent = lineCode;
    currentComparativeState = { lineCode, baseDate, comment };

    unifiedModal.classList.remove('hidden');
    document.body.classList.add('modal-open');
    switchModalView('comparative');

    // 2. Fetch Data (Line & System) in Parallel
    try {
        const [lineRes, systemRes] = await Promise.all([
            fetch(`/api/action-impact?line_code=${lineCode}&base_date=${baseDate}&window=7`),
            fetch(`/api/system-impact?base_date=${baseDate}&window=7`)
        ]);

        if (!lineRes.ok) {
            const errText = await lineRes.text();
            throw new Error(`Erro na API de Linha: ${lineRes.status} - ${errText}`);
        }
        if (!systemRes.ok) {
            const errText = await systemRes.text();
            throw new Error(`Erro na API de Sistema: ${systemRes.status} - ${errText}`);
        }

        const lineData = await lineRes.json();
        const systemData = await systemRes.json();

        renderComparativeDashboard(lineData, systemData);
    } catch (err) {
        console.error("Error fetching comparative impact:", err);
        alert(`Erro ao carregar dados comparativos: ${err.message}`);
    }
}

function renderComparativeDashboard(lineData, systemData) {
    if (!lineData || !systemData) {
        console.error("Missing data for comparative dashboard:", { lineData, systemData });
        return;
    }

    // 1. Line Stats
    const lineAvgBefore = lineData.avg_before || 0;
    const lineAvgAfter = lineData.avg_after || 0;
    const lineDelta = lineAvgAfter - lineAvgBefore;
    const linePercent = lineAvgBefore > 0 ? (lineDelta / lineAvgBefore * 100).toFixed(1) : 0;

    document.getElementById('comp-line-avg-before').textContent = lineAvgBefore.toFixed(1);
    document.getElementById('comp-line-avg-after').textContent = lineAvgAfter.toFixed(1);

    const lineDeltaEl = document.getElementById('comp-line-delta');
    lineDeltaEl.textContent = `${lineDelta > 0 ? '+' : ''}${lineDelta.toFixed(1)} (${linePercent}%)`;

    // UI Feedback for Line
    const lineCard = lineDeltaEl.closest('.stat-card');
    if (lineCard) {
        lineCard.classList.remove('success', 'danger');
        if (parseFloat(linePercent) > 2) lineCard.classList.add('success');
        else if (parseFloat(linePercent) < -2) lineCard.classList.add('danger');
    }

    // 2. System Stats
    const sysAvgBefore = systemData.avg_before || 0;
    const sysAvgAfter = systemData.avg_after || 0;
    const sysDelta = sysAvgAfter - sysAvgBefore;
    const sysPercent = sysAvgBefore > 0 ? (sysDelta / sysAvgBefore * 100).toFixed(1) : 0;

    document.getElementById('comp-sys-avg-before').textContent = sysAvgBefore.toLocaleString('pt-BR');
    document.getElementById('comp-sys-avg-after').textContent = sysAvgAfter.toLocaleString('pt-BR');

    const sysDeltaEl = document.getElementById('comp-sys-delta');
    sysDeltaEl.textContent = `${sysDelta > 0 ? '+' : ''}${sysDelta.toLocaleString('pt-BR')} (${sysPercent}%)`;

    const sysCard = sysDeltaEl.closest('.stat-card');
    if (sysCard) {
        sysCard.classList.remove('success', 'danger');
        if (parseFloat(sysPercent) > 1) sysCard.classList.add('success');
        else if (parseFloat(sysPercent) < -1) sysCard.classList.add('danger');
    }

    // 3. Render Charts
    renderCompChart('compLineChart', lineData, 'Impacto da Linha', compLineChart, data => compLineChart = data);
    renderCompChart('compSystemChart', systemData, 'Impacto do Sistema', compSystemChart, data => compSystemChart = data);

    // 4. Calculate Contribution (Line Delta / System Delta)
    const contribEl = document.getElementById('comp-line-contribution');
    if (contribEl) {
        if (Math.abs(sysDelta) > 0.01) { // Avoid division by zero or tiny variations
            const contribPerc = (lineDelta / sysDelta * 100);
            contribEl.textContent = `${contribPerc.toFixed(1)}%`;
            contribEl.title = `A linha representa ${contribPerc.toFixed(1)}% da variação absoluta observada no sistema.`;
        } else {
            contribEl.textContent = '0%';
        }
    }
}

function renderCompChart(canvasId, data, label, chartInstance, setChartInstance) {
    const ctx = document.getElementById(canvasId).getContext('2d');

    if (chartInstance) {
        chartInstance.destroy();
    }

    // Capture real dates for tooltips
    const realDatesBefore = data.before.map(d => d.date);
    const realDatesAfter = data.after.map(d => d.date);

    const labels = data.before.map((_, i) => `D${i + 1}`);
    const beforeVals = data.before.map(d => d.val);
    const afterVals = data.after.map(d => d.val);

    const newChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Antes da Ação',
                    data: beforeVals,
                    borderColor: 'rgba(245, 158, 11, 0.8)',
                    backgroundColor: 'rgba(245, 158, 11, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 4
                },
                {
                    label: 'Depois da Ação',
                    data: afterVals,
                    borderColor: 'rgba(16, 185, 129, 0.8)',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                    pointRadius: 4
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    callbacks: {
                        title: (context) => {
                            const idx = context[0].dataIndex;
                            const dsIdx = context[0].datasetIndex;
                            const dStr = dsIdx === 0 ? realDatesBefore[idx] : realDatesAfter[idx];
                            if (dStr) {
                                return new Date(dStr + 'T00:00:00').toLocaleDateString('pt-BR');
                            }
                            return `Dia ${idx + 1}`;
                        }
                    }
                },
                legend: { labels: { color: '#94a3b8', font: { size: 11 } } },
                title: { display: true, text: label, color: '#e2e8f0' }
            },
            scales: {
                y: { grid: { color: 'rgba(148, 163, 184, 0.1)' }, ticks: { color: '#94a3b8' } },
                x: { grid: { display: false }, ticks: { color: '#94a3b8' } }
            }
        }
    });

    setChartInstance(newChart);
}

function openLineDetail(lineCode) {
    console.log('DEBUG: openLineDetail for:', lineCode);

    const mainStart = document.getElementById('start-date').value;
    const mainEnd = document.getElementById('end-date').value;

    document.getElementById('detail-date-start').value = mainStart;
    document.getElementById('detail-date-end').value = mainEnd;
    document.getElementById('detail-line-title').innerText = lineCode;
    document.getElementById('unified-line-code').innerText = lineCode; // SYNC SHARED TITLE

    currentDetailState = {
        lineCode: lineCode,
        start: mainStart,
        end: mainEnd,
        dayOfWeek: 'all'
    };

    const dayFilter = document.getElementById('detail-day-filter');
    if (dayFilter) dayFilter.value = 'all';

    // OPEN THE MODAL FIRST
    document.getElementById('unified-modal').classList.remove('hidden');
    document.body.classList.add('modal-open');

    switchModalView('detail');

    // Clear history lists to avoid stale data if user switches tabs
    const actionList = document.getElementById('actions-list');
    if (actionList) actionList.innerHTML = '';

    fetchAndRenderLineDetail();

    // Fetch actions to populate the Impact Selector (quietly)
    fetchActionsHistory(lineCode, true);
}

function applyDetailDates() {
    const start = document.getElementById('detail-date-start').value;
    const end = document.getElementById('detail-date-end').value;

    if (!start || !end) return;

    currentDetailState.start = start;
    currentDetailState.end = end;
    fetchAndRenderLineDetail();
}

async function fetchAndRenderLineDetail() {
    const { lineCode, start, end } = currentDetailState;
    if (!lineCode) return;

    try {
        const res = await fetch(`/api/lines?line_code=${lineCode}&start=${start}&end=${end}`);
        const data = await res.json();
        state.lastDetailData = data;

        processAndRenderDetail();
    } catch (err) {
        console.error('Error fetching line detail:', err);
    }
}

function onDetailDayFilterChange() {
    const val = document.getElementById('detail-day-filter').value;
    currentDetailState.dayOfWeek = val;
    processAndRenderDetail();
}

function processAndRenderDetail() {
    const data = state.lastDetailData || [];
    const filter = currentDetailState.dayOfWeek;

    let filtered = [...data];
    if (filter !== 'all') {
        filtered = data.filter(item => {
            const date = new Date(item.date + 'T00:00:00');
            return date.getDay().toString() === filter;
        });
    }

    // Data is already sorted DESC by date from API, let's sort it ASC for the chart
    const chartData = [...filtered].sort((a, b) => a.date.localeCompare(b.date));

    renderDetailSummary(chartData);
    renderDetailChart(chartData);
    renderDetailTable(filtered); // Table stays DESC for recent first
}

function renderDetailSummary(data) {
    const total = data.reduce((acc, curr) => acc + (curr.realized_passengers || 0), 0);
    const avg = data.length > 0 ? (total / data.length) : 0;

    document.getElementById('detail-total-realized').innerText = Math.round(total).toLocaleString('pt-BR');
    document.getElementById('detail-avg-daily').innerText = avg.toFixed(1);

    // Naive trend calculation (last 3 vs previous 3)
    if (data.length >= 6) {
        const recent = data.slice(-3).reduce((a, b) => a + b.realized_passengers, 0);
        const older = data.slice(-6, -3).reduce((a, b) => a + b.realized_passengers, 0);
        const diff = recent - older;
        const trendEl = document.getElementById('detail-trend');

        if (diff > total * 0.05) {
            trendEl.innerText = 'CRESCENTE';
            trendEl.className = 'value diff-positive';
        } else if (diff < -total * 0.05) {
            trendEl.innerText = 'QUEDA';
            trendEl.className = 'value diff-negative';
        } else {
            trendEl.innerText = 'ESTÁVEL';
            trendEl.className = 'value';
        }
    }
}

function renderDetailChart(data) {
    const ctx = document.getElementById('detailChart').getContext('2d');
    if (detailChart) detailChart.destroy();

    const labels = data.map(d => {
        const date = new Date(d.date + 'T00:00:00');
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    });

    detailChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Previsto',
                    data: data.map(d => Math.round(d.predicted_passengers)),
                    borderColor: '#14b8a6', // Teal color for contrast
                    backgroundColor: 'rgba(20, 184, 166, 0.05)',
                    borderDash: [5, 3],
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: true,
                    tension: 0.2
                },
                {
                    label: 'Realizado',
                    data: data.map(d => Math.round(d.realized_passengers)),
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    pointRadius: 4,
                    pointBackgroundColor: '#10b981',
                    fill: true,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { display: false } },
                y: { ticks: { color: '#64748b', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.03)' } }
            }
        }
    });
}

function renderDetailTable(data) {
    const tbody = document.querySelector('#line-detail-table tbody');
    tbody.innerHTML = '';

    data.forEach(item => {
        const diff = item.realized_passengers - item.predicted_passengers;
        const perc = item.predicted_passengers > 0 ? (item.realized_passengers / item.predicted_passengers * 100) : 0;
        const cls = diff < 0 ? 'diff-negative' : 'diff-positive';

        const date = new Date(item.date + 'T00:00:00');
        const weekday = date.toLocaleDateString('pt-BR', { weekday: 'short' });

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${date.toLocaleDateString('pt-BR')}</td>
            <td style="text-transform: capitalize;">${weekday}</td>
            <td>${Math.round(item.predicted_passengers).toLocaleString()}</td>
            <td style="font-weight: 600;">${Math.round(item.realized_passengers).toLocaleString()}</td>
            <td class="${cls}">${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString()}</td>
            <td class="${cls} diff-tag">${perc.toFixed(1)}%</td>
        `;
        tbody.appendChild(tr);
    });
}

// Global exposure
window.prepareImpactModal = prepareImpactModal;
window.closeUnifiedModal = closeUnifiedModal;
window.switchModalView = switchModalView;
window.openImpactModal = openImpactModal;
window.openLineDetail = openLineDetail;
window.applyDetailDates = applyDetailDates;
window.handleImpactDateChange = handleImpactDateChange;
window.onDetailDayFilterChange = onDetailDayFilterChange;
window.openSelectionGrid = openSelectionGrid;
window.switchMainTab = switchMainTab;
window.deleteGroup = deleteGroup;
window.toggleLineInGroup = toggleLineInGroup;
window.switchGroupModalView = switchGroupModalView;
window.openUnifiedModal = openUnifiedModal;
window.deleteAnalysis = deleteAnalysis;
window.deleteAction = deleteAction;
window.handleClearData = handleClearData;

// Logic helpers
function setupUpload(elementId, endpoint) {
    const fileInput = document.getElementById(elementId);
    if (!fileInput) return;

    let isUploading = false;

    fileInput.addEventListener('change', async (e) => {
        if (isUploading) return;

        const file = e.target.files[0];
        if (!file) return;

        const label = document.querySelector(`label[for="${elementId}"]`);
        const originalText = label.textContent;

        isUploading = true;
        label.textContent = 'PROCESSANDO...';
        fileInput.disabled = true;

        try {
            const res = await fetch(endpoint, {
                method: 'POST',
                body: file
            });

            if (res.ok) {
                alert('Importação concluída!');
                await fetchLines();
            } else {
                const errorData = await res.text();
                alert('Erro na importação: ' + errorData);
            }
        } catch (err) {
            console.error('Upload error:', err);
            alert('Erro de conexão ou erro interno no servidor.');
        } finally {
            label.textContent = originalText;
            fileInput.value = '';
            fileInput.disabled = false;
            isUploading = false;
        }
    });
}

async function handleLogin(e) {
    e.preventDefault();
    const username = e.target.username.value;
    const password = e.target.password.value;
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.success) {
            state.user = data.user;
            localStorage.setItem('bus_user', JSON.stringify(state.user));
            showDashboard();
        } else {
            alert('Login falhou: ' + data.message);
        }
    } catch (err) { alert('Erro de conexão'); }
}

function handleLogout() {
    localStorage.removeItem('bus_user');
    window.location.reload();
}

// End of standard logic
// --- Impact Action Selector Logic ---
function populateImpactActionsSelect(actions) {
    const select = document.getElementById('impact-action-select');
    const tabBtn = document.getElementById('tab-btn-impact');
    const emptyState = document.getElementById('impact-empty-state');
    const impactBody = document.querySelector('#modal-impact-view .impact-modal-body');

    if (!select) return;

    select.innerHTML = '<option value="">Selecione uma ação...</option>';

    // Impact tab visibility is now strictly managed by syncModalTabs(view)
    // if (tabBtn) tabBtn.classList.remove('hidden');

    if (!actions || actions.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (impactBody) impactBody.classList.add('hidden');
        return;
    }

    // Actions exist: show content, hide empty state
    if (emptyState) emptyState.classList.add('hidden');
    if (impactBody) impactBody.classList.remove('hidden');

    // Sort actions by implementation_date (stable sort) then by created_at
    const sorted = [...actions].sort((a, b) => {
        const dateA = a.implementation_date || '0000-00-00';
        const dateB = b.implementation_date || '0000-00-00';
        if (dateA !== dateB) return dateB.localeCompare(dateA); // Newest first
        return b.id - a.id;
    });

    sorted.forEach(action => {
        const option = document.createElement('option');
        option.value = action.id;
        const dateStr = action.implementation_date
            ? new Date(action.implementation_date + 'T00:00:00').toLocaleDateString('pt-BR')
            : 'Sem data';
        option.textContent = `${dateStr} - ${action.comment.substring(0, 50)}${action.comment.length > 50 ? '...' : ''}`;
        select.appendChild(option);
    });

    // Auto-select logic: respect existing selection or default to latest
    if (sorted.length > 0) {
        const currentId = currentImpactState.actionId;
        const target = (currentId && sorted.find(a => a.id == currentId)) ? sorted.find(a => a.id == currentId) : sorted[0];

        select.value = target.id;

        // Sync currentImpactState
        currentImpactState = {
            lineCode: target.line_code,
            baseDate: target.implementation_date,
            window: 7,
            comment: target.comment,
            actionId: target.id
        };

        // Update labels and inputs for Impact View
        const actionDate = new Date(target.implementation_date + 'T00:00:00');
        const defaultEnd = new Date(actionDate);
        defaultEnd.setDate(defaultEnd.getDate() + 6);
        const endVal = defaultEnd.toISOString().split('T')[0];

        document.getElementById('impact-date-start').value = target.implementation_date;
        document.getElementById('impact-date-end').value = endVal;

        document.getElementById('impact-base-date').innerText = target.implementation_date
            ? actionDate.toLocaleDateString('pt-BR')
            : '-';
        document.getElementById('impact-action-desc').innerText = target.comment;
    }
}

function onImpactActionSelectChange() {
    const select = document.getElementById('impact-action-select');
    const actionId = select.value;
    if (!actionId) return;

    const action = state.lastActions.find(a => a.id == actionId);
    if (action) {
        openImpactModal(action.line_code, action.implementation_date, action.comment, action.id);
    }
}

// Ensure functions are global for onclick handlers
window.onImpactActionSelectChange = onImpactActionSelectChange;
window.prepareImpactModal = prepareImpactModal;
window.openLineDetail = openLineDetail;
window.openUnifiedModal = openUnifiedModal;
window.switchModalView = switchModalView;
window.applyImpactDates = applyImpactDates;
window.handleImpactDateChange = handleImpactDateChange;
window.applyDetailDates = applyDetailDates;
window.openComparativeImpact = openComparativeImpact;
window.saveImpactConclusion = saveImpactConclusion;
