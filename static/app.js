const state = {
    user: JSON.parse(localStorage.getItem('bus_user')) || null,
    lines: [],
    availableLineCodes: [],
    impactSelectedLines: new Set(),
    groups: [],
    selectedGroupId: null,
    lastActions: [],
    lastEvents: [],
    lastDetailData: [],
    macroFilterGroupId: null
};

const APP_VERSION = "2.3.2";
let lastProcessedHash = null;

window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.error(`[CORE v${APP_VERSION}] ERRO GLOBAL:`, msg, 'linha', lineNo);
    return false;
};

function showNotification(message, type = 'info') {
    const container = document.getElementById('notification-container');
    if (!container) return;

    const notification = document.createElement('div');
    notification.className = `notification ${type}`;

    let icon = 'info-circle';
    if (type === 'success') icon = 'check-circle';
    if (type === 'error') icon = 'exclamation-circle';

    notification.innerHTML = `
        <i class="fas fa-${icon}"></i>
        <span>${message}</span>
    `;

    container.appendChild(notification);

    // Trigger animation
    setTimeout(() => notification.classList.add('show'), 10);

    // Remove after 4s
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => notification.remove(), 300);
    }, 4000);
}
window.showNotification = showNotification;

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

    // Set Default Dates (Last 7 days to Today)
    const today = new Date();
    const lastWeek = new Date();
    lastWeek.setDate(today.getDate() - 7);

    if (document.getElementById('start-date')) {
        document.getElementById('start-date').valueAsDate = lastWeek;
        document.getElementById('end-date').valueAsDate = today;
    }

    if (document.getElementById('impact-start-date')) {
        document.getElementById('impact-start-date').valueAsDate = lastWeek;
        document.getElementById('impact-end-date').valueAsDate = today;
    }

    if (savedUser) {
        state.user = JSON.parse(savedUser);
        showDashboard();
    } else {
        showLogin();
    }

    // Display version
    const versionEl = document.getElementById('app-version-indicator');
    if (versionEl) versionEl.textContent = `v${APP_VERSION}`;

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
            window.location.hash = '#operacional';
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

    const clearDataBtn = document.getElementById('btn-open-clear-data');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', openClearDataModal);
    }

    const selectionSearch = document.getElementById('search-selection-lines');
    if (selectionSearch) {
        selectionSearch.addEventListener('input', renderSelectionGrid);
    }



    // Setup Uploads
    setupUpload('csv-upload', '/api/import-csv');
    setupUpload('csv-predict', '/api/import-predicted');

    const exportBtn = document.getElementById('btn-export-group');
    if (exportBtn) {
        exportBtn.onclick = exportGroupToExcel;
    }

    // Initial navigation — always respect the real URL hash
    handleNavigation(true);

    // Hash Navigation - Native Events + Active Watchdog (Fail-safe)
    window.addEventListener('hashchange', handleNavigation);
    window.addEventListener('popstate', handleNavigation);

    // Watchdog Polling (Anti-freeze) - only activates after first navigation
    setInterval(() => {
        if (lastProcessedHash === null) return; // Not yet initialized
        const currentHash = window.location.hash || '#macro';
        if (currentHash !== lastProcessedHash) {
            console.log(`[CORE v${APP_VERSION}] Watchdog detected hash drift: ${lastProcessedHash} -> ${currentHash}`);
            handleNavigation();
        }
    }, 200);

    // Operational Search
    setupOperationalSearch();
}

function setupOperationalSearch() {
    const input = document.getElementById('operational-search-input');
    const resultsContainer = document.getElementById('operational-search-results');

    if (!input || !resultsContainer) return;

    input.addEventListener('input', (e) => {
        const query = e.target.value.toLowerCase().trim();
        if (query.length < 2) {
            resultsContainer.classList.add('hidden');
            return;
        }

        const lines = state.lines || [];
        // Unique lines by code
        const uniqueLines = Array.from(new Set(lines.map(l => l.line_code)))
            .map(code => lines.find(l => l.line_code === code));

        const matches = uniqueLines.filter(l =>
            l.line_code.toLowerCase().includes(query) ||
            (l.line_name && l.line_name.toLowerCase().includes(query))
        );

        if (matches.length > 0) {
            resultsContainer.innerHTML = matches.map(l => {
                const group = (state.groups || []).find(g => g.lines && g.lines.includes(l.line_code));
                const groupBadge = group
                    ? `<span style="font-size:0.65rem;background:rgba(59,130,246,0.15);color:var(--primary-color);border:1px solid rgba(59,130,246,0.3);border-radius:4px;padding:1px 6px;margin-left:6px;">${group.name}</span>`
                    : `<span style="font-size:0.65rem;color:var(--text-muted);margin-left:6px;">Sem grupo</span>`;
                return `
                <div class="search-result-item" onclick="window.openLineDetail('${l.line_code}'); window.clearOperationalSearch()">
                    <div>
                        <span style="font-weight: bold; color: var(--primary-color)">${l.line_code}</span>
                        <small style="margin-left: 8px;">${l.line_name || ''}</small>
                        ${groupBadge}
                    </div>
                    <small>Ver Análise</small>
                </div>`;
            }).join('');
            resultsContainer.classList.remove('hidden');
        } else {
            resultsContainer.innerHTML = '<div style="padding: 12px; color: var(--text-muted); text-align: center;">Nenhuma linha encontrada</div>';
            resultsContainer.classList.remove('hidden');
        }
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!input.contains(e.target) && !resultsContainer.contains(e.target)) {
            resultsContainer.classList.add('hidden');
        }
    });

    // Close on escape
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            resultsContainer.classList.add('hidden');
            input.blur();
        }
    });
}

window.clearOperationalSearch = function () {
    const input = document.getElementById('operational-search-input');
    const resultsContainer = document.getElementById('operational-search-results');
    if (input) input.value = '';
    if (resultsContainer) resultsContainer.classList.add('hidden');
};

function handleNavigation(force) {
    try {
        const hash = window.location.hash || '#macro';
        if (!force && hash === lastProcessedHash) return; // Prevent loop

        lastProcessedHash = hash;
        console.log(`[CORE v${APP_VERSION}] handleNavigation executing for:`, hash);

        if (hash === '#macro') {
            applyView('macro');
            exitGroupUI();
        } else if (hash === '#operacional') {
            applyView('operacional');
            exitGroupUI();
        } else if (hash === '#impacto') {
            applyView('impacto');
            exitGroupUI();
        } else if (hash === '#acoes') {
            applyView('acoes');
            exitGroupUI();
        } else if (hash.startsWith('#group-')) {
            const groupId = parseInt(hash.split('-')[1]);
            const group = state.groups.find(g => g.id === groupId);
            if (group) {
                applyView('operacional');
                enterGroupUI(group);
            } else {
                console.warn(`[CORE v${APP_VERSION}] Group ${groupId} not in memory, sync required`);
                // Fallback attempt: if we have groups but not this one, maybe it was deleted
                if (state.groups.length > 0) {
                    window.location.hash = '#operacional';
                }
            }
        } else if (hash.startsWith('#detail-')) {
            const lineCode = hash.split('-')[1];
            openLineDetail(lineCode, true); // called from URL navigation
        } else {
            console.warn(`[CORE v${APP_VERSION}] Unknown route: ${hash}`);
            window.location.hash = '#macro';
        }
    } catch (err) {
        console.error(`[CORE v${APP_VERSION}] CRITICAL NAV ERROR:`, err);
    }
}
window.handleNavigation = handleNavigation;

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
    console.log("exitGroupUI: restoring operational main UI");
    state.selectedGroupId = null;

    const titleEl = document.getElementById('dashboard-title');
    if (titleEl && window.location.hash === '#operacional') {
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
    console.log(`[v${APP_VERSION}] switchMainTab requested:`, tab);
    window.location.hash = '#' + tab;
}
window.switchMainTab = switchMainTab;

function applyView(tab) {
    console.log("DEBUG: applyView entering for:", tab);
    if (!tab) return;
    state.currentView = tab;

    const macroTab = document.getElementById('tab-macro');
    const operTab = document.getElementById('tab-operacional');
    const impactTab = document.getElementById('tab-impacto');
    const acoesTab = document.getElementById('tab-acoes');
    const macroContent = document.getElementById('macro-tab-content');
    const operContent = document.getElementById('operational-tab-content');
    const impactContent = document.getElementById('impact-tab-content');
    const acoesContent = document.getElementById('acoes-tab-content');
    const title = document.getElementById('dashboard-title');
    const searchContainer = document.getElementById('operational-search-container');

    console.log("DEBUG: Tab elements find status:", {
        macroTab: !!macroTab,
        operTab: !!operTab,
        impactTab: !!impactTab,
        acoesTab: !!acoesTab,
        macroContent: !!macroContent,
        operContent: !!operContent,
        impactContent: !!impactContent,
        acoesContent: !!acoesContent
    });

    // Reset visibility
    [macroTab, operTab, impactTab, acoesTab].forEach(t => t?.classList.remove('active'));
    [macroContent, operContent, impactContent, acoesContent].forEach(c => c?.classList.add('hidden'));

    if (searchContainer) searchContainer.classList.add('hidden');

    if (tab === 'macro') {
        macroTab?.classList.add('active');
        macroContent?.classList.remove('hidden');
        if (title) title.textContent = 'Panorama Macro';
        const globalToolbar = document.querySelector('.toolbar .actions .filter-group');
        if (globalToolbar) globalToolbar.style.display = 'flex';
        renderMacroDashboard();
    } else if (tab === 'operacional') {
        operTab?.classList.add('active');
        operContent?.classList.remove('hidden');
        if (title) title.textContent = 'Visão Geral da Operação';
        const globalToolbar = document.querySelector('.toolbar .actions .filter-group');
        if (globalToolbar) globalToolbar.style.display = 'flex';
        if (searchContainer) searchContainer.classList.remove('hidden');
        renderGroups();
    } else if (tab === 'impacto') {
        impactTab?.classList.add('active');
        impactContent?.classList.remove('hidden');
        if (title) title.textContent = 'Relatórios de Impacto';
        const globalToolbar = document.querySelector('.toolbar .actions .filter-group');
        if (globalToolbar) globalToolbar.style.display = 'none'; // Individual filters are used here
        renderImpactPage();
    } else if (tab === 'acoes') {
        acoesTab?.classList.add('active');
        acoesContent?.classList.remove('hidden');
        if (title) title.textContent = 'Gestão de Ações';
        const globalToolbar = document.querySelector('.toolbar .actions .filter-group');
        if (globalToolbar) globalToolbar.style.display = 'none';

        // Initialize action filters if empty
        const startInput = document.getElementById('actions-filter-start');
        const endInput = document.getElementById('actions-filter-end');
        if (startInput && endInput && !startInput.value) {
            const today = new Date();
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(today.getDate() - 7);

            startInput.value = sevenDaysAgo.toISOString().split('T')[0];
            endInput.value = today.toISOString().split('T')[0];
        }

        renderActionsTab();
    }
}

async function renderImpactPage() {
    const tbody = document.querySelector('#impact-report-table tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 20px;">Carregando histórico de impacto...</td></tr>';

    // Ensure available lines are loaded for the filter
    if (state.availableLineCodes.length === 0) {
        await fetchAvailableLines();
    } else {
        // Even if loaded, ensure filter dropdown is populated (it might have been cleared or not injected yet)
        populateImpactLineFilter();
    }

    const start = document.getElementById('impact-start-date').value;
    const end = document.getElementById('impact-end-date').value;

    // Multi-line selection from state
    const selectedLines = state.impactSelectedLines ? Array.from(state.impactSelectedLines) : [];

    try {
        let url = '/api/global-actions-impact';
        const params = new URLSearchParams();
        if (start) params.append('start', start);
        if (end) params.append('end', end);
        if (selectedLines.length > 0) params.append('line', selectedLines.join(','));
        if (params.toString()) url += `?${params.toString()}`;

        const response = await fetch(url);
        if (!response.ok) {
            console.error(`Fetch error ${response.status} for ${url}`);
            throw new Error(`Erro na API: ${response.status}`);
        }
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
                card.classList.remove('success', 'danger', 'stable');
                if (avgVariation > 2) card.classList.add('success');
                else if (avgVariation < -2) card.classList.add('danger');
                else card.classList.add('stable');
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
            systemicCard.classList.remove('success', 'danger', 'stable');
            if (totalSystemicImpact > 50) systemicCard.classList.add('success');
            else if (totalSystemicImpact < -50) systemicCard.classList.add('danger');
            else systemicCard.classList.add('stable');
        }

        tbody.innerHTML = '';
        data.forEach(item => {
            const row = document.createElement('tr');

            let statusClass = 'label-stable';
            let arrow = '―';
            if (item.status === 'Melhorou') {
                statusClass = 'label-success';
                arrow = '↑';
            } else if (item.status === 'Piorou') {
                statusClass = 'label-danger';
                arrow = '↓';
            } else {
                statusClass = 'label-stable';
                arrow = '―';
            }

            const impactClass = (arrow === '↑') ? 'diff-positive' :
                (arrow === '↓' ? 'diff-negative' : 'diff-stable');

            row.onclick = () => openComparativeImpact(item.line_code, item.date, item.comment);
            row.style.cursor = 'pointer';
            row.title = "Clique para ver comparativo linha vs sistema";

            row.innerHTML = `
                <td><strong>${item.line_code}</strong></td>
                <td>${item.date}</td>
                <td style="font-size: 0.8rem;">${item.comment || 'Ação Operacional'}</td>
                <td style="font-weight: 500;">${item.avg_before}</td>
                <td style="font-weight: 500; color: #fff;">${item.avg_after}</td>
                <td class="${impactClass}"><strong>${item.diff > 0 ? '+' : ''}${item.diff}</strong> (${item.percent > 0 ? '+' : ''}${item.percent}%)</td>
                <td><span class="status-badge ${statusClass}">${arrow}</span></td>
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
        // Only force navigation if NOT already in a detail view (avoid double openLineDetail)
        const currentHash = window.location.hash || '';
        if (!currentHash.startsWith('#detail-')) {
            handleNavigation(true);
        }
    } catch (err) {
        console.error('Failed to fetch groups', err);
    }
}

let groupClickTimer = null;
function renderGroups() {
    const container = document.getElementById('groups-container');
    if (!container) return;
    container.innerHTML = '';

    state.groups.forEach(group => {
        // Calculate totals for this group
        let totalPredicted = 0;
        let totalRealized = 0;

        state.lines.forEach(line => {
            if (group.lines.includes(line.line_code)) {
                totalPredicted += (line.predicted_passengers || 0);
                totalRealized += (line.realized_passengers || 0);
            }
        });

        const diff = totalRealized - totalPredicted;
        const diffClass = diff < 0 ? 'text-negative' : (diff > 0 ? 'text-positive' : '');
        const diffSign = diff > 0 ? '+' : '';

        const card = document.createElement('div');
        const isActive = state.macroFilterGroupId === group.id;
        card.className = `group-card${isActive ? ' active-filter' : ''}`;
        card.innerHTML = `
            <div class="group-card-header">
                <h3>${group.name}</h3>
                <span class="group-line-count">${group.lines.length} linhas</span>
            </div>
            <div class="group-card-body">
                <div class="group-stat-row">
                    <span class="label">Previsto:</span>
                    <span class="value">${Math.round(totalPredicted).toLocaleString()}</span>
                </div>
                <div class="group-stat-row">
                    <span class="label">Realizado:</span>
                    <span class="value">${Math.round(totalRealized).toLocaleString()}</span>
                </div>
                <div class="group-stat-diff ${diffClass}">
                    ${diffSign}${Math.round(diff).toLocaleString()}
                </div>
            </div>
        `;

        card.onclick = (e) => {
            if (groupClickTimer) {
                clearTimeout(groupClickTimer);
                groupClickTimer = null;
                // Double Click: Enter Group
                filterByGroup(group);
            } else {
                groupClickTimer = setTimeout(() => {
                    groupClickTimer = null;
                    // Single Click: Toggle Macro Filter
                    if (state.macroFilterGroupId === group.id) {
                        state.macroFilterGroupId = null;
                    } else {
                        state.macroFilterGroupId = group.id;
                    }
                    renderGroups(); // Re-render to show active state
                }, 250);
            }
        };

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

    // 2. Aggregate all data
    const aggregated = {};
    let dataToAggregate = state.lines;

    if (state.macroFilterGroupId) {
        const selectedGroup = state.groups.find(g => g.id === state.macroFilterGroupId);
        if (selectedGroup) {
            dataToAggregate = state.lines.filter(l => selectedGroup.lines.includes(l.line_code));
        }
    }

    dataToAggregate.forEach(line => {
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
                <td>
                    <button class="btn accent x-small" style="padding: 2px 6px; font-size: 0.7rem;" 
                            onclick="openUnifiedModal('${item.line_code}')">AÇÕES</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    };

    renderRows(top5, topTbody);
    renderRows(bottom5, bottomTbody);
}

function filterByGroup(group) {
    console.log(`[v${APP_VERSION}] filterByGroup requested:`, group.name);
    window.location.hash = `#group-${group.id}`;
}
window.filterByGroup = filterByGroup;

// Sort state for the group lines table
let groupTableSort = { col: 'line', dir: 'asc' };

window.setGroupSort = function (col) {
    if (groupTableSort.col === col) {
        groupTableSort.dir = groupTableSort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        groupTableSort.col = col;
        groupTableSort.dir = 'asc';
    }
    renderAggregatedTable();
};

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

    const allLines = Object.values(aggregated);

    // Apply user-selected sort
    allLines.sort((a, b) => {
        const dir = groupTableSort.dir === 'asc' ? 1 : -1;
        if (groupTableSort.col === 'diff') {
            return ((a.realized - a.predicted) - (b.realized - b.predicted)) * dir;
        }
        return a.line_code.localeCompare(b.line_code, undefined, { numeric: true }) * dir;
    });

    // Refresh sort icons
    const iconLine = document.getElementById('sort-icon-line');
    const iconDiff = document.getElementById('sort-icon-diff');
    if (iconLine) iconLine.textContent = groupTableSort.col === 'line' ? (groupTableSort.dir === 'asc' ? '▲' : '▼') : '↕';
    if (iconDiff) iconDiff.textContent = groupTableSort.col === 'diff' ? (groupTableSort.dir === 'asc' ? '▲' : '▼') : '↕';

    allLines.forEach(line => {
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
// --- Unified Analysis & Actions ---
async function openUnifiedModal(lineCode) {
    window.currentActionsLine = lineCode;
    window.currentAnalysisLine = lineCode;

    document.getElementById('unified-line-code').textContent = lineCode;

    // Sync macro dates to history filters
    const dashboardStart = document.getElementById('start-date').value;
    const dashboardEnd = document.getElementById('end-date').value;
    const filterStart = document.getElementById('history-filter-start');
    const filterEnd = document.getElementById('history-filter-end');
    if (filterStart && dashboardStart) filterStart.value = dashboardStart;
    if (filterEnd && dashboardEnd) filterEnd.value = dashboardEnd;

    // Mostra versão para debug
    const vSpan = document.getElementById('app-version-indicator');
    if (vSpan) vSpan.innerText = "v" + APP_VERSION;

    document.getElementById('unified-modal').classList.remove('hidden');
    document.body.classList.add('modal-open');

    // Reset to history view by default
    switchModalView('history');

    // Clear inputs and state
    clearEventForm();

    // Fetch unified history
    await fetchLineEvents(lineCode);
}
window.openUnifiedModal = openUnifiedModal;

function closeUnifiedModal() {
    document.getElementById('unified-modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
    window.currentActionsLine = null;

    // Only restore URL if we're currently at a #detail- hash
    // (happens when user navigated directly to #detail-X via URL)
    if (window.location.hash.startsWith('#detail-')) {
        const returnTo = '#' + (state.currentView || 'operacional');
        history.replaceState(null, '', returnTo);
        lastProcessedHash = returnTo;
        handleNavigation(true);
    }
}

// --- SYSTEM: UNIFIED EVENTS (ANALYSIS & ACTIONS) ---

function setEventFlow(flow) {
    const typeInput = document.getElementById('event-type');
    const formTitle = document.getElementById('form-title');
    const form = document.getElementById('unified-event-form');
    const fieldAnalysis = document.getElementById('field-group-analysis');
    const fieldAction = document.getElementById('field-group-action');
    const fieldExtraAnalysis = document.getElementById('field-group-extra-analysis');
    const fieldExtraAction = document.getElementById('field-group-extra-action');
    const btnAnalysis = document.getElementById('btn-flow-analysis');
    const btnAction = document.getElementById('btn-flow-action');
    const cbAction = document.getElementById('toggle-include-action');
    const cbAnalysis = document.getElementById('toggle-include-analysis');
    const toggleActionSection = document.getElementById('toggle-action-section');
    const toggleAnalysisSection = document.getElementById('toggle-analysis-section');
    const fileSection = document.getElementById('file-upload-section');

    if (!typeInput) return;
    typeInput.value = flow;

    // Show the form
    if (form) form.classList.remove('hidden');

    // Reset checkboxes, extra fields, and toggle sections
    if (cbAction) cbAction.checked = false;
    if (cbAnalysis) cbAnalysis.checked = false;
    if (fieldExtraAnalysis) fieldExtraAnalysis.classList.add('hidden');
    if (fieldExtraAction) fieldExtraAction.classList.add('hidden');

    if (flow === 'ANALYSIS') {
        if (formTitle) formTitle.innerText = "Registrar Análise";
        // Show analysis textarea, hide action textarea
        if (fieldAnalysis) fieldAnalysis.classList.remove('hidden');
        if (fieldAction) fieldAction.classList.add('hidden');
        // Show file upload in right column, hide it from extra-analysis area
        if (fileSection) fileSection.classList.remove('hidden');
        // Show 'add action' toggle section, hide 'add analysis' toggle section
        if (toggleActionSection) toggleActionSection.classList.remove('hidden');
        if (toggleAnalysisSection) toggleAnalysisSection.classList.add('hidden');
        // Button styles
        if (btnAnalysis) { btnAnalysis.classList.add('active-flow'); btnAnalysis.style.boxShadow = "0 0 15px var(--primary-color)"; }
        if (btnAction) { btnAction.classList.remove('active-flow'); btnAction.style.boxShadow = "none"; }

    } else if (flow === 'ACTION') {
        if (formTitle) formTitle.innerText = "Registrar Ação";
        // Show action textarea, hide analysis textarea
        if (fieldAnalysis) fieldAnalysis.classList.add('hidden');
        if (fieldAction) fieldAction.classList.remove('hidden');
        // Hide file upload from right column (appears below extra-analysis when checkbox checked)
        if (fileSection) fileSection.classList.add('hidden');
        // Show 'add analysis' toggle section, hide 'add action' toggle section
        if (toggleActionSection) toggleActionSection.classList.add('hidden');
        if (toggleAnalysisSection) toggleAnalysisSection.classList.remove('hidden');
        // Button styles
        if (btnAction) { btnAction.classList.add('active-flow'); btnAction.style.boxShadow = "0 0 15px var(--accent-color)"; }
        if (btnAnalysis) { btnAnalysis.classList.remove('active-flow'); btnAnalysis.style.boxShadow = "none"; }
    }
}

function collapseEventForm() {
    const form = document.getElementById('unified-event-form');
    if (form) form.classList.add('hidden');
    clearEventForm();
    const btnAnalysis = document.getElementById('btn-flow-analysis');
    const btnAction = document.getElementById('btn-flow-action');
    if (btnAnalysis) { btnAnalysis.classList.remove('active-flow'); btnAnalysis.style.boxShadow = "none"; }
    if (btnAction) { btnAction.classList.remove('active-flow'); btnAction.style.boxShadow = "none"; }
}

function toggleExtraField(field) {
    if (field === 'action') {
        // ANALYSIS mode: show/hide the extra action textarea
        const cb = document.getElementById('toggle-include-action');
        const el = document.getElementById('field-group-extra-action');
        if (el) el.classList.toggle('hidden', !cb.checked);
    } else if (field === 'analysis') {
        // ACTION mode: show/hide the extra analysis textarea + file upload
        const cb = document.getElementById('toggle-include-analysis');
        const el = document.getElementById('field-group-extra-analysis');
        if (el) el.classList.toggle('hidden', !cb.checked);
    }
}

function updateFileLabel() {
    const input = document.getElementById('event-file');
    const hasFile = input && input.files && input.files.length > 0;
    const text = hasFile ? `📎 ${input.files[0].name}` : null;
    const color = hasFile ? 'var(--primary-color)' : '';

    const span1 = document.getElementById('event-file-name');
    const span2 = document.getElementById('event-file-name-action');
    [span1, span2].forEach(el => {
        if (!el) return;
        el.innerText = text || (el.id === 'event-file-name' ? '📎 Adicionar arquivo' : '📎 Adicionar arquivo de análise');
        el.style.color = color;
    });
}

async function fetchLineEvents(lineCode, quiet = false) {
    const list = document.getElementById('unified-history-list');
    if (!quiet && list) list.innerHTML = '<div class="placeholder-text">Carregando...</div>';

    try {
        const res = await fetch(`/api/line-events?line_code=${lineCode}`);
        const data = await res.json();
        state.lastEvents = data;

        // Populate state.lastActions for backward-compatibility with impact modal.
        const actions = data.filter(e => e.type === 'ACTION' || e.type === 'BOTH');
        state.lastActions = actions.map(a => ({
            ...a,
            comment: a.action_taken || a.fact || 'Ação registrada'
        }));

        // Initial render with potential filters
        renderEventsList();

        // Also populate impact select if needed
        populateImpactActionsSelect(state.lastActions);
    } catch (err) {
        console.error('Error fetching events:', err);
    }
}

window.applyHistoryFilter = function () {
    renderEventsList();
};

function renderEventsList() {
    const list = document.getElementById('unified-history-list');
    const counter = document.getElementById('history-counter');
    if (!list) return;

    const filterStart = document.getElementById('history-filter-start').value;
    const filterEnd = document.getElementById('history-filter-end').value;

    let filteredData = state.lastEvents;

    if (filterStart || filterEnd) {
        filteredData = state.lastEvents.filter(item => {
            if (!item.implementation_date) return true; // Always include if pending
            let ok = true;
            if (filterStart && item.implementation_date < filterStart) ok = false;
            if (filterEnd && item.implementation_date > filterEnd) ok = false;
            return ok;
        });
    }

    if (counter) counter.innerText = `${filteredData.length} registros`;

    if (filteredData.length === 0) {
        list.innerHTML = '<div class="placeholder-text">Nenhum evento encontrado no período selecionado.</div>';
        return;
    }

    list.innerHTML = '';
    filteredData.forEach(item => {
        const div = document.createElement('div');
        div.className = `analysis-item event-${item.type.toLowerCase()}`;

        const dateStr = item.implementation_date
            ? new Date(item.implementation_date + 'T00:00:00').toLocaleDateString('pt-BR')
            : 'Sem data';
        const createdStr = new Date(item.created_at).toLocaleString('pt-BR');

        let fileLink = '';
        if (item.filename) {
            const label = item.original_filename || item.filename || 'Arquivo Anexo';
            fileLink = `<div class="attachment-box" style="margin-top:8px;">
                        <a href="/api/analysis/download?id=${item.id}" class="attachment-link">📎 ${label}</a>
                    </div>`;
        }

        // Build badge(s) and content based on type
        let badgeHTML = '';
        let contentHTML = '';

        if (item.type === 'BOTH') {
            badgeHTML = `
                        <span class="badge analysis" style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid var(--primary-color);color:var(--primary-color);">ANÁLISE</span>
                        <span style="font-size:0.6rem;color:var(--text-muted);margin:0 3px;">+</span>
                        <span class="badge action" style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid var(--accent-color);color:var(--accent-color);">AÇÃO</span>`;
            contentHTML = `
                        <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px;">
                            <div style="background:rgba(var(--primary-rgb,100,180,255),0.05);border-left:3px solid var(--primary-color);border-radius:0 6px 6px 0;padding:8px 10px;">
                                <div style="font-size:0.6rem;color:var(--primary-color);font-weight:700;text-transform:uppercase;margin-bottom:5px;">📊 Análise</div>
                                ${item.fact ? `<p style="margin:2px 0;font-size:0.82rem;"><strong>Fato:</strong> ${item.fact}</p>` : ''}
                                ${item.analysis_conclusion ? `<p style="margin:4px 0 0;font-size:0.82rem;"><strong>Conclusão:</strong> ${item.analysis_conclusion}</p>` : ''}
                            </div>
                            <div style="background:rgba(var(--accent-rgb,255,140,80),0.05);border-left:3px solid var(--accent-color);border-radius:0 6px 6px 0;padding:8px 10px;">
                                <div style="font-size:0.6rem;color:var(--accent-color);font-weight:700;text-transform:uppercase;margin-bottom:5px;">⚡ Ação</div>
                                ${item.action_taken ? `<p style="margin:2px 0;font-size:0.82rem;">${item.action_taken}</p>` : '<p style="margin:2px 0;font-size:0.82rem;color:var(--text-muted);">—</p>'}
                            </div>
                        </div>`;
        } else if (item.type === 'ANALYSIS') {
            badgeHTML = `<span class="badge analysis" style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid var(--primary-color);color:var(--primary-color);">ANÁLISE</span>`;
            contentHTML = `<div class="event-content" style="margin-top:8px;font-size:0.85rem;color:var(--text-main);">
                        ${item.fact ? `<p style="margin:2px 0;"><strong>Fato:</strong> ${item.fact}</p>` : ''}
                        ${item.analysis_conclusion ? `<p style="margin:4px 0 0;"><strong>Conclusão:</strong> ${item.analysis_conclusion}</p>` : ''}
                    </div>`;
        } else {
            badgeHTML = `<span class="badge action" style="font-size:0.6rem;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.07);border:1px solid var(--accent-color);color:var(--accent-color);">AÇÃO</span>`;
            contentHTML = `<div class="event-content" style="margin-top:8px;font-size:0.85rem;color:var(--text-main);">
                        ${item.fact ? `<p style="margin:2px 0;"><strong>Fato:</strong> ${item.fact}</p>` : ''}
                        ${item.action_taken ? `<p style="margin:4px 0 0;"><strong>Ação:</strong> ${item.action_taken}</p>` : ''}
                    </div>`;
        }

        div.innerHTML = `
                    <div class="analysis-info">
                        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                            <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;">
                                ${badgeHTML}
                                <span style="font-size:0.92rem;color:var(--text-main);font-weight:700;">${dateStr}</span>
                                <small style="font-size:0.8rem;color:var(--text-muted);opacity:0.8;">por ${item.analyst || 'Sistema'}</small>
                            </div>
                            <div style="display:flex;gap:6px;flex-shrink:0;">
                                <button class="btn secondary small" onclick="editEvent(${item.id})" style="padding:4px 12px;font-size:0.8rem;">Editar</button>
                                <button class="btn small" onclick="deleteEvent(${item.id})" style="padding:4px 12px;font-size:0.8rem;background:rgba(239,68,68,0.15);color:#f87171;border:1px solid rgba(239,68,68,0.4);">Excluir</button>
                            </div>
                        </div>
                        ${contentHTML}
                        ${fileLink}
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
                            <span style="font-size:0.7rem;color:var(--text-muted);opacity:0.6;">Registro #${item.id}</span>
                            <span style="font-size:0.7rem;color:var(--text-muted);opacity:0.6;">Criado em ${createdStr}</span>
                        </div>
                    </div>
                `;
        list.appendChild(div);
    });
}

async function saveUnifiedEvent() {
    const id = document.getElementById('event-id').value;
    const baseType = document.getElementById('event-type').value;
    const fact = document.getElementById('event-fact').value.trim();
    const analyst = document.getElementById('event-analyst').value.trim();
    const dateInput = document.getElementById('event-date');
    const date = dateInput ? dateInput.value : '';
    const fileInput = document.getElementById('event-file');

    if (!baseType) { alert('Por favor, selecione "Registrar Análise" ou "Registrar Ação".'); return; }
    if (!fact) { alert('Por favor, descreva o fato/contexto.'); return; }
    if (!window.currentActionsLine) { alert('Linha não identificada.'); return; }

    // Read main fields based on flow
    let conc = '';
    let action = '';
    const cbAction = document.getElementById('toggle-include-action');
    const cbAnalysis = document.getElementById('toggle-include-analysis');

    if (baseType === 'ANALYSIS') {
        conc = (document.getElementById('event-analysis-conclusion')?.value || '').trim();
        if (cbAction?.checked) {
            action = (document.getElementById('event-action-taken-extra')?.value || '').trim();
        }
    } else if (baseType === 'ACTION') {
        action = (document.getElementById('event-action-taken')?.value || '').trim();
        if (cbAnalysis?.checked) {
            conc = (document.getElementById('event-analysis-conclusion-extra')?.value || '').trim();
        }
    }

    // Determine final type
    let finalType = baseType;
    if (conc && action) finalType = 'BOTH';
    else if (conc) finalType = 'ANALYSIS';
    else if (action) finalType = 'ACTION';

    const formData = new FormData();
    if (id) formData.append('id', id);
    formData.append('line_code', window.currentActionsLine);
    formData.append('type', finalType);
    formData.append('fact', fact);
    formData.append('analysis_conclusion', conc);
    formData.append('action_taken', action);
    formData.append('analyst', analyst);
    formData.append('implementation_date', date);
    formData.append('author_id', state.user ? state.user.id : 0);
    if (fileInput && fileInput.files[0]) formData.append('file', fileInput.files[0]);

    const btn = document.getElementById('btn-save-event');
    if (btn) { btn.disabled = true; btn.innerText = "SALVANDO..."; }

    try {
        const res = await fetch('/api/line-events', { method: 'POST', body: formData });
        if (res.ok) {
            collapseEventForm();
            await fetchLineEvents(window.currentActionsLine);
        } else {
            alert('Erro ao salvar evento.');
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão.');
    } finally {
        if (btn) { btn.disabled = false; btn.innerText = "SALVAR EVENTO"; }
    }
}

function clearEventForm() {
    ['event-id', 'event-type', 'event-fact', 'event-analysis-conclusion',
        'event-analysis-conclusion-extra', 'event-action-taken', 'event-action-taken-extra',
        'event-analyst', 'event-date', 'event-file'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });

    // Reset both file name labels
    const fn1 = document.getElementById('event-file-name');
    const fn2 = document.getElementById('event-file-name-action');
    if (fn1) { fn1.innerText = "📎 Adicionar arquivo"; fn1.style.color = ''; }
    if (fn2) { fn2.innerText = "📎 Adicionar arquivo de análise"; fn2.style.color = ''; }

    // Reset checkboxes
    const cbA = document.getElementById('toggle-include-action');
    const cbB = document.getElementById('toggle-include-analysis');
    if (cbA) cbA.checked = false;
    if (cbB) cbB.checked = false;

    // Hide all field groups, toggle sections and edit-controls
    ['field-group-analysis', 'field-group-action',
        'field-group-extra-analysis', 'field-group-extra-action',
        'file-upload-section', 'toggle-action-section', 'toggle-analysis-section',
        'edit-controls'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.classList.add('hidden');
        });
}

async function editEvent(id) {
    console.log("DEBUG: Iniciando editEvent para ID:", id);

    // Normalização agressiva para busca: procura por ID como número ou string
    let event = state.lastEvents.find(e => e.id == id || (e.ID && e.ID == id));

    // Fallback: Se não achar no estado local, pode ser que o estado foi sobrescrito ou está dessincronizado
    if (!event) {
        console.warn(`DEBUG: Registro #${id} não achado no cache. Tentando recarregar histórico para ${window.currentActionsLine}...`);
        await fetchLineEvents(window.currentActionsLine, true);
        event = state.lastEvents.find(e => e.id == id || (e.ID && e.ID == id));
    }

    if (!event) {
        console.error("DEBUG: Evento ainda não encontrado após recarga:", id);
        alert(`Erro Crítico: Registro #${id} não encontrado na memória.\n\nDetalhes para Suporte:\n- ID buscado: ${id}\n- Itens no cache: ${state.lastEvents.length}\n- Linha atual: ${window.currentActionsLine}`);
        return;
    }

    clearEventForm();

    try {
        console.log("DEBUG: Editando evento tipo:", event.type, "dados:", event);

        const idField = document.getElementById('event-id');
        if (idField) idField.value = event.id || event.ID;

        const factField = document.getElementById('event-fact');
        if (factField) factField.value = event.fact || '';

        const analystField = document.getElementById('event-analyst');
        if (analystField) analystField.value = event.analyst || '';

        const dateField = document.getElementById('event-date');
        if (dateField) dateField.value = event.implementation_date || '';

        // Determina o fluxo visual baseado no tipo salvo
        if (event.type === 'BOTH' || event.type === 'ANALYSIS') {
            setEventFlow('ANALYSIS');

            const concField = document.getElementById('event-analysis-conclusion');
            if (concField) concField.value = event.analysis_conclusion || '';

            if (event.type === 'BOTH') {
                const cbAction = document.getElementById('toggle-include-action');
                if (cbAction) {
                    cbAction.checked = true;
                    toggleExtraField('action');
                    const extraActionField = document.getElementById('event-action-taken-extra');
                    if (extraActionField) extraActionField.value = event.action_taken || '';
                }
            }
        } else if (event.type === 'ACTION') {
            setEventFlow('ACTION');
            const actionField = document.getElementById('event-action-taken');
            if (actionField) actionField.value = event.action_taken || '';

            // Suporte a análise extra no fluxo de ação se existir
            if (event.analysis_conclusion) {
                const cbAnalysis = document.getElementById('toggle-include-analysis');
                if (cbAnalysis) {
                    cbAnalysis.checked = true;
                    toggleExtraField('analysis');
                    const extraConcField = document.getElementById('event-analysis-conclusion-extra');
                    if (extraConcField) extraConcField.value = event.analysis_conclusion || '';
                }
            }
        }

        const title = document.getElementById('form-title');
        if (title) title.innerText = "Editando Registro #" + (event.id || event.ID);

        const form = document.getElementById('unified-event-form');
        if (form) {
            form.classList.remove('hidden');
            form.style.display = 'block';
            form.scrollIntoView({ behavior: 'smooth' });
        }

        const ec = document.getElementById('edit-controls');
        if (ec) ec.classList.remove('hidden');

        console.log("DEBUG: editEvent concluído para ID:", id);
    } catch (err) {
        console.error("DEBUG: Erro em editEvent:", err);
        alert("Erro ao abrir formulário de edição: " + err.message);
    }
}

function cancelEventEdit() {
    clearEventForm();
}

async function deleteEvent(id) {
    if (!confirm('Deseja realmente excluir este registro?')) return;
    try {
        const res = await fetch(`/api/line-events?id=${id}&userId=${state.user ? state.user.id : 0}`, { method: 'DELETE' });
        if (res.ok) await fetchLineEvents(window.currentActionsLine);
        else alert('Erro ao excluir.');
    } catch (err) { alert('Erro de conexão.'); }
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

        // Also populate impact filter if it exists
        populateImpactLineFilter();
    } catch (err) {
        console.error('Failed to fetch available lines', err);
    }
}

function populateImpactLineFilter() {
    const trigger = document.getElementById('impact-line-trigger');
    const dropdown = document.getElementById('impact-line-dropdown');
    const searchInput = document.getElementById('impact-line-search');
    const list = document.getElementById('impact-line-list');

    if (!trigger || !dropdown || !list) return;

    // Prevent re-adding listeners if already initialized
    if (trigger.dataset.inited) {
        if (list.renderList) list.renderList(searchInput.value);
        if (trigger.updateTriggerText) trigger.updateTriggerText();
        return;
    }
    trigger.onclick = (e) => {
        e.stopPropagation();
        dropdown.classList.toggle('active');
        if (dropdown.classList.contains('active')) searchInput.focus();
    };

    // Global click listener for closing dropdown
    if (!window.impactDropdownInited) {
        document.addEventListener('click', (e) => {
            if (!dropdown.contains(e.target) && !trigger.contains(e.target)) {
                dropdown.classList.remove('active');
            }
        });
        window.impactDropdownInited = true;
    }

    if (!state.impactSelectedLines) state.impactSelectedLines = new Set();

    const updateTriggerText = () => {
        const span = trigger.querySelector('span');
        if (state.impactSelectedLines.size === 0) span.textContent = 'Todas as Linhas';
        else if (state.impactSelectedLines.size === 1) span.textContent = Array.from(state.impactSelectedLines)[0];
        else span.textContent = `${state.impactSelectedLines.size} Selecionadas`;
    };
    trigger.updateTriggerText = updateTriggerText;

    const renderList = (term = '') => {
        list.innerHTML = '';
        const filtered = state.availableLineCodes.filter(c => term === '' || c.toLowerCase().includes(term.toLowerCase())).sort();

        filtered.forEach(code => {
            const div = document.createElement('div');
            div.className = 'multi-select-item';
            const isChecked = state.impactSelectedLines.has(code);
            div.innerHTML = `<input type="checkbox" value="${code}" ${isChecked ? 'checked' : ''}> <span>${code}</span>`;
            div.onclick = (e) => {
                const cb = div.querySelector('input');
                if (e.target !== cb) cb.checked = !cb.checked;
                if (cb.checked) state.impactSelectedLines.add(code);
                else state.impactSelectedLines.delete(code);
                updateTriggerText();
            };
            list.appendChild(div);
        });
    };
    list.renderList = renderList;

    searchInput.oninput = (e) => renderList(e.target.value);
    renderList();
    updateTriggerText();
    trigger.dataset.inited = "true";
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

    // classList properly overrides display:none !important from .hidden — style.display cannot
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
        // Data is fetched by openLineDetail or applyDetailDates — do NOT double-fetch here
    } else {
        if (historyView) historyView.classList.remove('hidden');
        // Reload events only when switching to history tab
        if (window.currentActionsLine) {
            fetchLineEvents(window.currentActionsLine, true);
        }
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

    const spanBefore = document.getElementById('impact-avg-before');
    const spanAfter = document.getElementById('impact-avg-after');

    if (spanBefore) {
        spanBefore.innerText = avgBefore.toFixed(1);
        spanBefore.className = 'value'; // Removed yellow class
    }
    if (spanAfter) {
        spanAfter.innerText = avgAfter.toFixed(1);
        spanAfter.className = 'value'; // Removed yellow class
    }

    const deltaEl = document.getElementById('impact-delta');
    if (deltaEl) {
        let arrow = '―'; // Estável
        let cls = 'diff-stable';

        if (delta > 0.05) { // Threshold pequeno para considerar mudança real
            arrow = '↑';
            cls = 'diff-positive';
        } else if (delta < -0.05) {
            arrow = '↓';
            cls = 'diff-negative';
        }

        deltaEl.innerText = `${arrow} ${delta > 0 ? '+' : ''}${delta.toFixed(1)} (${perc.toFixed(perc !== 0 ? 1 : 0)}%)`;
        deltaEl.className = `value ${cls}`;
    }
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
    if (!tbody) return;
    tbody.innerHTML = '';

    data.before.forEach((itemB, i) => {
        const itemA = data.after[i] || { val: 0, date: '' };
        const diff = itemA.val - itemB.val;
        const perc = itemB.val !== 0 ? (diff / itemB.val * 100) : 0;

        let arrow = '―';
        let cls = 'diff-stable';
        if (diff > 0.05) { arrow = '↑'; cls = 'diff-positive'; }
        else if (diff < -0.05) { arrow = '↓'; cls = 'diff-negative'; }

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
                ${arrow} ${diff > 0 ? '+' : ''}${Math.round(diff).toLocaleString('pt-BR')}
            </td>
            <td class="${cls}" style="font-weight: 700; font-size: 0.85rem; text-align: right;">
                ${arrow} ${diff > 0 ? '+' : ''}${perc.toFixed(perc !== 0 ? 1 : 0)}%
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

function openLineDetail(lineCode, fromNavigation = false) {
    console.log('[CORE] openLineDetail for:', lineCode, 'fromNavigation:', fromNavigation);

    const mainStart = document.getElementById('start-date').value;
    const mainEnd = document.getElementById('end-date').value;

    const startEl = document.getElementById('detail-date-start');
    const endEl = document.getElementById('detail-date-end');
    if (startEl) startEl.value = mainStart;
    if (endEl) endEl.value = mainEnd;

    const titleEl = document.getElementById('detail-line-title');
    const unifiedTitleEl = document.getElementById('unified-line-code');
    if (titleEl) titleEl.innerText = lineCode;
    if (unifiedTitleEl) unifiedTitleEl.innerText = lineCode;

    // Only update the URL when navigated to directly (e.g. user typed #detail-002 in address bar).
    // When called from a button or search bar, keep the URL unchanged so closing restores naturally.
    if (fromNavigation) {
        const targetHash = '#detail-' + lineCode;
        if (window.location.hash !== targetHash) {
            history.replaceState(null, '', targetHash);
            lastProcessedHash = targetHash;
        }
    }

    currentDetailState = {
        lineCode: lineCode,
        start: mainStart,
        end: mainEnd,
        dayOfWeek: 'all'
    };
    window.currentActionsLine = lineCode;

    const dayFilter = document.getElementById('detail-day-filter');
    if (dayFilter) dayFilter.value = 'all';

    const modal = document.getElementById('unified-modal');
    if (modal) modal.classList.remove('hidden');
    document.body.classList.add('modal-open');

    switchModalView('detail');

    const actionList = document.getElementById('actions-list');
    if (actionList) actionList.innerHTML = '';

    fetchAndRenderLineDetail();
    fetchLineEvents(lineCode, true);
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
    console.log('[DETAIL] fetchAndRenderLineDetail called with:', { lineCode, start, end });
    if (!lineCode) { console.warn('[DETAIL] Aborted: no lineCode in currentDetailState'); return; }

    try {
        const url = `/api/lines?line_code=${lineCode}&start=${start}&end=${end}`;
        console.log('[DETAIL] Fetching:', url);
        const res = await fetch(url);
        const data = await res.json();
        console.log('[DETAIL] API returned', data.length, 'rows for', lineCode);
        state.lastDetailData = data;

        processAndRenderDetail();
    } catch (err) {
        console.error('[DETAIL] Error fetching line detail:', err);
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
    console.log('[DETAIL] renderDetailSummary with', data.length, 'rows');
    const total = data.reduce((acc, curr) => acc + (curr.realized_passengers || 0), 0);
    const avg = data.length > 0 ? (total / data.length) : 0;

    const totalEl = document.getElementById('detail-total-realized');
    const avgEl = document.getElementById('detail-avg-daily');
    if (totalEl) totalEl.innerText = Math.round(total).toLocaleString('pt-BR');
    if (avgEl) avgEl.innerText = avg.toFixed(1);

    if (data.length >= 6) {
        const recent = data.slice(-3).reduce((a, b) => a + (b.realized_passengers || 0), 0);
        const older = data.slice(-6, -3).reduce((a, b) => a + (b.realized_passengers || 0), 0);
        const diff = recent - older;
        const trendEl = document.getElementById('detail-trend');
        if (trendEl) {
            if (diff > total * 0.05) { trendEl.innerText = 'CRESCENTE'; trendEl.className = 'value diff-positive'; }
            else if (diff < -total * 0.05) { trendEl.innerText = 'QUEDA'; trendEl.className = 'value diff-negative'; }
            else { trendEl.innerText = 'ESTÁVEL'; trendEl.className = 'value'; }
        }
    }
}

function renderDetailChart(data) {
    console.log('[DETAIL] renderDetailChart with', data.length, 'rows');
    const canvas = document.getElementById('detailChart');
    if (!canvas) { console.error('[DETAIL] detailChart canvas NOT FOUND'); return; }

    const container = canvas.parentElement;
    console.log('[DETAIL] canvas container size:', container?.offsetWidth, 'x', container?.offsetHeight);

    const labels = data.map(d => {
        const date = new Date(d.date + 'T00:00:00');
        return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    });

    // Use requestAnimationFrame to ensure container has layout dimensions before Chart.js measures
    requestAnimationFrame(() => {
        if (detailChart) detailChart.destroy();
        const ctx = canvas.getContext('2d');
        detailChart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Previsto',
                        data: data.map(d => Math.round(d.predicted_passengers)),
                        borderColor: '#14b8a6',
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
        console.log('[DETAIL] Chart created, size:', detailChart.width, 'x', detailChart.height);
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
window.deleteEvent = deleteEvent;
// (deleteAction was removed — use deleteEvent for all event deletion)
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
        const analystStr = action.analyst ? ` [${action.analyst}]` : '';
        option.textContent = `${dateStr} - ${action.comment.substring(0, 50)}${action.comment.length > 50 ? '...' : ''}${analystStr}`;
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

        const analystLabel = target.analyst ? ` (Analista: ${target.analyst})` : '';
        document.getElementById('impact-action-desc').innerText = target.comment + analystLabel;
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
window.setEventFlow = setEventFlow;
window.saveUnifiedEvent = saveUnifiedEvent;
window.editEvent = editEvent;
window.cancelEventEdit = cancelEventEdit;
window.deleteEvent = deleteEvent;
window.updateFileLabel = updateFileLabel;
window.handleNavigation = handleNavigation;
window.applyView = applyView;
window.exitGroupUI = exitGroupUI;
window.enterGroupUI = enterGroupUI;
window.switchMainTab = switchMainTab;
window.handleClearData = handleClearData;
window.renderImpactPage = renderImpactPage;
window.closeUnifiedModal = closeUnifiedModal;
window.collapseEventForm = collapseEventForm;
window.toggleExtraField = toggleExtraField;
window.switchGroupModalView = switchGroupModalView;
window.filterByGroup = filterByGroup;

/** --- CUSTOM MULTI-SELECT DROPDOWN LOGIC --- **/

/**
 * Filter multi-select options based on search input
 */
window.filterMSOptions = function (input) {
    const dropdown = input.closest('.ms-dropdown');
    const filter = input.value.toLowerCase();
    const options = dropdown.querySelectorAll('.ms-option');

    options.forEach(option => {
        const text = option.querySelector('span').textContent.toLowerCase();
        if (text.includes(filter)) {
            option.style.display = 'flex';
        } else {
            option.style.display = 'none';
        }
    });
};

window.toggleMSDropdown = function (id) {
    const dropdown = document.getElementById(id);
    const wasActive = dropdown.classList.contains('active');

    // Close others
    document.querySelectorAll('.ms-dropdown').forEach(d => {
        if (d.id !== id) d.classList.remove('active');
    });

    dropdown.classList.toggle('active');

    // Reset search when opening
    if (!wasActive) {
        const searchInput = dropdown.querySelector('.ms-search-input');
        if (searchInput) {
            searchInput.value = '';
            window.filterMSOptions(searchInput);
            searchInput.focus();
        }
    }
};

window.toggleMSOption = function (element, dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    const isSingleSelect = dropdown.getAttribute('data-selection') === 'single';

    if (isSingleSelect) {
        // Clear others
        dropdown.querySelectorAll('.ms-option').forEach(opt => {
            if (opt !== element) {
                opt.classList.remove('selected');
                const checkbox = opt.querySelector('input[type="checkbox"]');
                if (checkbox) checkbox.checked = false;
            }
        });

        // Toggle current
        element.classList.toggle('selected');
        const checkbox = element.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = element.classList.contains('selected');

        // Close dropdown if selected (standard behavior for single select)
        if (element.classList.contains('selected')) {
            setTimeout(() => dropdown.classList.remove('active'), 200);
        }
    } else {
        // Multiple Select (default)
        element.classList.toggle('selected');
        const checkbox = element.querySelector('input[type="checkbox"]');
        if (checkbox) checkbox.checked = element.classList.contains('selected');
    }

    updateMSDisplayText(dropdownId);
};

window.updateMSDisplayText = function (dropdownId) {
    const dropdown = document.getElementById(dropdownId);
    if (!dropdown) return;
    const selectedOptions = [...dropdown.querySelectorAll('.ms-option.selected span')].map(s => s.textContent.trim());
    const displayElement = dropdown.querySelector('.ms-selected-text');

    if (selectedOptions.length === 0) {
        if (dropdownId.includes('fact')) {
            displayElement.textContent = 'Selecionar Fato...';
        } else if (dropdownId.includes('cause')) {
            displayElement.textContent = 'Selecionar Causa(s)...';
        } else {
            displayElement.textContent = 'Selecionar Ação(ões)...';
        }
        displayElement.classList.add('ms-placeholder');
    } else {
        displayElement.textContent = selectedOptions.join(', ');
        displayElement.classList.remove('ms-placeholder');
    }
};

// Global click listener to close dropdowns
document.addEventListener('click', (e) => {
    if (!e.target.closest('.ms-dropdown') && !e.target.closest('.ms-search-container')) {
        document.querySelectorAll('.ms-dropdown').forEach(d => d.classList.remove('active'));
    }
});

/** --- NEW ACTIONS TAB LOGIC --- **/

window.renderActionsTab = async function () {
    const tableBody = document.querySelector('#actions-history-table tbody');
    if (!tableBody) return;
    tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Carregando...</td></tr>';

    const start = document.getElementById('actions-filter-start')?.value;
    const end = document.getElementById('actions-filter-end')?.value;

    try {
        let url = '/api/line-events';
        if (start && end) {
            url += `?start=${start}&end=${end}`;
        }
        const res = await fetch(url);
        const events = await res.json();

        // Fetch groups to map group_id or line to group name
        const groupRes = await fetch('/api/groups');
        const groups = await groupRes.json();

        const formatDBDate = (str) => {
            if (!str) return '-';
            // If it's YYYY-MM-DD (possibly with time like YYYY-MM-DD HH:mm:ss)
            // Strip anything after space or T
            const cleanStr = str.split(' ')[0].split('T')[0];
            if (cleanStr.includes('-') && cleanStr.split('-')[0].length === 4) {
                const [y, m, d] = cleanStr.split('-');
                return `${d}/${m}/${y}`;
            }
            // Fallback for full ISO strings or already formatted strings
            const d = new Date(str);
            if (isNaN(d.getTime())) return str;
            const day = String(d.getDate()).padStart(2, '0');
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const year = d.getFullYear();
            return `${day}/${month}/${year}`;
        };

        tableBody.innerHTML = events.map(event => {
            const group = groups.find(g => g.lines && g.lines.includes(event.line_code)) || { name: '-' };
            // Prioritize implementation_date (action date) and created_at (which we'll now override if sent manually)
            // Wait, I should use the field I'm about to send: 'upload_date' or just keep it in 'created_at' on backend?
            // Let's assume I'll send it as 'created_at' to reuse the column, or server.py will handle it.
            const regDate = formatDBDate(event.created_at);
            const actionDate = formatDBDate(event.implementation_date);

            return `
                <tr>
                    <td style="font-weight: 500; color: var(--text-muted);">${regDate}</td>
                    <td>${actionDate}</td>
                    <td>${group.name}</td>
                    <td>${event.line_code}</td>
                    <td>${event.fact || '-'}</td>
                    <td>${event.cause || '-'}</td>
                    <td>${event.action_taken || '-'}</td>
                    <td>
                        <button class="btn text-only" onclick='openSummaryModal(${JSON.stringify(event.analysis_conclusion || "")})' style="font-size: 0.75rem; color: var(--primary-color);">
                            VER ANÁLISE
                        </button>
                    </td>
                    <td>${event.analyst || '-'}</td>
                    <td>
                        <div style="display: flex; gap: 8px;">
                            <button class="btn text-only" onclick="editActionSimplified(${event.id})" style="color: var(--primary-color); padding: 5px;">
                                <i class="fas fa-edit"></i> EDITAR
                            </button>
                            <button class="btn text-only" onclick="deleteActionSimplified(${event.id})" style="color: #ef4444; padding: 5px;">
                                <i class="fas fa-trash"></i> APAGAR
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        console.error('Error rendering actions tab:', err);
        tableBody.innerHTML = '<tr><td colspan="10" style="text-align:center; color: #ef4444;">Erro ao carregar dados.</td></tr>';
    }
}

window.exportActionsToExcel = function () {
    const start = document.getElementById('actions-filter-start')?.value;
    const end = document.getElementById('actions-filter-end')?.value;

    if (!start || !end) {
        if (window.showNotification) {
            window.showNotification('Por favor, selecione um período.', 'info');
        } else {
            alert('Por favor, selecione um período.');
        }
        return;
    }

    const url = `/api/export-actions?start=${start}&end=${end}`;
    window.location.href = url;
}

window.openActionRegistrationModal = function () {
    const modal = document.getElementById('action-reg-modal');
    if (modal) {
        modal.classList.remove('hidden');
        populateRegGroupsDropdown();
        document.getElementById('action-reg-form').reset();
        document.getElementById('reg-event-id').value = '';
        document.getElementById('action-reg-title').textContent = 'Registrar Ação';

        // Clear multi-select dropdowns
        document.querySelectorAll('.ms-dropdown').forEach(dropdown => {
            dropdown.querySelectorAll('.ms-option').forEach(opt => {
                opt.classList.remove('selected');
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = false;
            });
            updateMSDisplayText(dropdown.id);
        });

        // Default upload date to today, leave action date empty
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('reg-action-date').value = '';
        document.getElementById('reg-upload-date').value = today;
    }
}

window.closeActionRegModal = function () {
    const modal = document.getElementById('action-reg-modal');
    if (modal) modal.classList.add('hidden');
}

function populateRegGroupsDropdown() {
    const groupSelect = document.getElementById('reg-group');
    if (!groupSelect) return;

    groupSelect.innerHTML = '<option value="">— Selecionar Grupo —</option>' +
        state.groups.map(g => `<option value="${g.id}">${g.name}</option>`).join('');
}

window.updateRegLinesDropdown = function () {
    const groupId = parseInt(document.getElementById('reg-group').value);
    const lineSelect = document.getElementById('reg-line');
    if (!lineSelect) return;

    if (!groupId) {
        lineSelect.innerHTML = '<option value="">— Selecionar Linha —</option>';
        lineSelect.disabled = true;
        return;
    }

    const group = state.groups.find(g => g.id === groupId);
    if (group && group.lines) {
        lineSelect.innerHTML = '<option value="">— Selecionar Linha —</option>' +
            group.lines.map(code => `<option value="${code}">${code}</option>`).join('');
        lineSelect.disabled = false;
    }
}

window.saveActionRegistration = async function (e) {
    if (e) e.preventDefault();

    const formData = new FormData();
    formData.append('implementation_date', document.getElementById('reg-action-date').value);
    formData.append('created_at', document.getElementById('reg-upload-date').value); // Overriding created_at with manual selection
    formData.append('analyst', document.getElementById('reg-analyst').value);
    formData.append('line_code', document.getElementById('reg-line').value);

    // Collect Fact (Single Select Custom Dropdown)
    const selectedFact = document.querySelector('#reg-fact-dropdown .ms-option.selected span')?.textContent.replace(/\s+/g, ' ').trim() || '';
    formData.append('fact', selectedFact);

    // Collect dropdown values
    const selectedCauses = [...document.querySelectorAll('#reg-cause-dropdown .ms-option.selected span')].map(s => s.textContent.replace(/\s+/g, ' ').trim());
    const selectedActions = [...document.querySelectorAll('#reg-action-dropdown .ms-option.selected span')].map(s => s.textContent.replace(/\s+/g, ' ').trim());

    formData.append('cause', selectedCauses.join(', '));
    formData.append('action_taken', selectedActions.join(', '));
    formData.append('analysis_conclusion', document.getElementById('reg-analysis').value);
    formData.append('type', 'ACTION');
    formData.append('author_id', state.user?.id || 1);

    const eventId = document.getElementById('reg-event-id').value;
    if (eventId) {
        formData.append('id', eventId);
    }

    try {
        const res = await fetch('/api/line-events', {
            method: 'POST',
            body: formData
        });

        if (res.ok) {
            closeActionRegModal();
            renderActionsTab();
            // Optional: alert or notification
            if (window.showNotification) {
                window.showNotification('Ação registrada com sucesso!', 'success');
            } else {
                alert('Ação registrada com sucesso!');
            }
        } else {
            const err = await res.json();
            alert('Erro ao salvar: ' + (err.error || 'Erro desconhecido'));
        }
    } catch (err) {
        console.error('Error saving action registration:', err);
        alert('Erro de conexão com o servidor.');
    }
}

window.openSummaryModal = function (text) {
    const modal = document.getElementById('analysis-summary-modal');
    const textEl = document.getElementById('summary-text');
    if (modal && textEl) {
        textEl.textContent = text || 'Sem resumo disponível.';
        modal.classList.remove('hidden');
    }
}

window.closeSummaryModal = function () {
    const modal = document.getElementById('analysis-summary-modal');
    if (modal) modal.classList.add('hidden');
}

// Initial attachment of form listener
document.addEventListener('submit', (e) => {
    if (e.target.id === 'action-reg-form') {
        window.saveActionRegistration(e);
    }
});
function openClearDataModal() {
    document.getElementById('clear-data-modal').classList.remove('hidden');
    document.body.classList.add('modal-open');
}

function closeClearDataModal() {
    document.getElementById('clear-data-modal').classList.add('hidden');
    document.body.classList.remove('modal-open');
}

async function confirmClearData() {
    const targets = [];
    if (document.getElementById('clear-actions').checked) targets.push('actions');
    if (document.getElementById('clear-predicted').checked) targets.push('predicted');
    if (document.getElementById('clear-realized').checked) targets.push('realized');
    if (document.getElementById('clear-groups').checked) targets.push('groups');
    if (document.getElementById('clear-distribution').checked) targets.push('distribution');

    if (targets.length === 0) {
        showNotification('Selecione ao menos uma categoria para limpar.', 'error');
        return;
    }

    if (!confirm('VOCÊ TEM CERTEZA?\nEsta ação excluirá permanentemente os dados selecionados.')) {
        return;
    }

    try {
        const response = await fetch('/api/clear-data', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                userId: state.user.id,
                targets: targets
            })
        });

        if (response.ok) {
            showNotification('Os dados selecionados foram apagados com sucesso!', 'success');
            closeClearDataModal();

            // Comprehensive refresh
            await fetchGroups();
            await fetchLines();

            if (targets.includes('actions')) {
                if (typeof renderActionsTab === 'function') {
                    renderActionsTab();
                }
            }
        } else {
            const err = await response.text();
            showNotification('Erro ao limpar dados: ' + err, 'error');
        }
    } catch (error) {
        console.error('Clear Data Error:', error);
        showNotification('Erro na requisição de limpeza.', 'error');
    }
}
async function editActionSimplified(id) {
    try {
        const res = await fetch('/api/line-events');
        const events = await res.json();
        const event = events.find(e => e.id === id);

        if (!event) {
            showNotification('Registro não encontrado.', 'error');
            return;
        }

        const modal = document.getElementById('action-reg-modal');
        modal.classList.remove('hidden');
        document.getElementById('action-reg-title').textContent = 'Editar Ação';
        document.getElementById('reg-event-id').value = event.id;

        // Strip time from dates for input[type=date]
        const stripDate = (str) => str ? str.split(' ')[0].split('T')[0] : '';

        document.getElementById('reg-action-date').value = stripDate(event.implementation_date);
        document.getElementById('reg-upload-date').value = stripDate(event.created_at);
        document.getElementById('reg-analyst').value = event.analyst || '';
        document.getElementById('reg-analysis').value = event.analysis_conclusion || '';

        // Pre-select Fact (Single Select)
        const fact = event.fact || '';
        document.querySelectorAll('#reg-fact-dropdown .ms-option').forEach(opt => {
            const text = opt.querySelector('span').textContent.trim();
            if (text === fact) {
                opt.classList.add('selected');
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = true;
            } else {
                opt.classList.remove('selected');
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = false;
            }
        });
        updateMSDisplayText('reg-fact-dropdown');

        // Handle multi-select dropdowns
        const causes = event.cause ? event.cause.split(', ').map(s => s.trim()) : [];
        const actions = event.action_taken ? event.action_taken.split(', ').map(s => s.trim()) : [];

        // Pre-select Causes
        document.querySelectorAll('#reg-cause-dropdown .ms-option').forEach(opt => {
            const text = opt.querySelector('span').textContent.trim();
            if (causes.includes(text)) {
                opt.classList.add('selected');
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = true;
            } else {
                opt.classList.remove('selected');
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = false;
            }
        });
        updateMSDisplayText('reg-cause-dropdown');

        // Pre-select Actions
        document.querySelectorAll('#reg-action-dropdown .ms-option').forEach(opt => {
            const text = opt.querySelector('span').textContent.trim();
            if (actions.includes(text)) {
                opt.classList.add('selected');
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = true;
            } else {
                opt.classList.remove('selected');
                const cb = opt.querySelector('input[type="checkbox"]');
                if (cb) cb.checked = false;
            }
        });
        updateMSDisplayText('reg-action-dropdown');

        // Handle Group/Line dependency
        populateRegGroupsDropdown();

        // Trigger line dropdown update manually
        window.updateRegLinesDropdown();

        // Find group that contains this line
        const groupRes = await fetch('/api/groups');
        const groups = await groupRes.json();
        const group = groups.find(g => g.lines && g.lines.includes(event.line_code));

        if (group) {
            document.getElementById('reg-group').value = group.id;
            updateRegLinesDropdown();
            document.getElementById('reg-line').value = event.line_code;
        }
    } catch (err) {
        console.error('Error in editActionSimplified:', err);
        showNotification('Erro ao carregar dados para edição.', 'error');
    }
}

async function deleteActionSimplified(id) {
    if (!state.user || state.user.role !== 'MASTER') {
        showNotification('Acesso negado para excluir.', 'error');
        return;
    }

    if (!confirm('Deseja realmente excluir este registro de ação permanentemente?')) return;

    try {
        const res = await fetch(`/api/line-events?id=${id}&userId=${state.user.id}`, {
            method: 'DELETE'
        });

        if (res.ok) {
            showNotification('Ação removida com sucesso!', 'success');
            renderActionsTab();
        } else {
            const err = await res.text();
            showNotification('Erro ao excluir: ' + err, 'error');
        }
    } catch (err) {
        console.error('Delete Action Error:', err);
        showNotification('Erro de conexão.', 'error');
    }
}

window.editActionSimplified = editActionSimplified;
window.deleteActionSimplified = deleteActionSimplified;
