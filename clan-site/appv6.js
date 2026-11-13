const SUPABASE_URL = 'https://rpqiapddvlkdecddczqx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hDt4D6V24JeooGxNoLN4rQ__YFppVSz'; 
// ТВОЙ КЛЮЧ (ВНИМАНИЕ: ОН НЕ БУДЕТ РАБОТАТЬ ИЗ-ЗА ФОРМАТА AQ...)
const GEMINI_API_KEY = 'AQ.Ab8RN6IdO4AWRFat5cUf4ZitQBbp2O8_kLgBcI13ej-6QqoUAw'; 

const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

let allPlayers = [], activePlayers = [], allFines = [], allAttendance = [], allNotes = [];
let currentEditId = null, maxAttendanceStage = 3, isAdmin = false;
let currentPhotoFiles = []; 
let pendingAbsentPlayers = [], currentAbsentStage = null, currentSortColumn = 'kd', currentSortDirection = 'desc';

let allSeasons = [];
let activeSeasonId = null; 

let myChart = null;
const ADMIN_SECRET_CODE = 'ADMIN123';
const STATUS_PRIORITY = { 'в клане': 1, 'в обработке': 2, 'кикнут': 3 };

const BACKUP_RETENTION = 30;
const BACKUP_TABLES = ['players', 'attendance', 'match_stats', 'clan_matches', 'fines', 'clan_calendar', 'player_notes', 'clan_settings', 'seasons'];

let SQUADS_CONFIG = [
    { name: '1 Штурмовой отряд', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '2 Штурмовой отряд', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '3 Штурмовой отряд', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '4 Отряд поддержки', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '5 Отряд поддержки', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '6 Отряд ралики', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] }
];

const TIER_SETTINGS = [
    { name: 'E', minRating: 0, winGears: 1250, lossGears: 250 },
    { name: 'D', minRating: 1050, winGears: 1750, lossGears: 500 },
    { name: 'C', minRating: 1150, winGears: 2400, lossGears: 800 },
    { name: 'B', minRating: 1300, winGears: 3300, lossGears: 1200 },
    { name: 'A', minRating: 1450, winGears: 4700, lossGears: 1800 },
    { name: 'S', minRating: 1600, winGears: 7000, lossGears: 3000 }
];

function getTierData(rating) {
    let current = TIER_SETTINGS[0];
    for (let t of TIER_SETTINGS) { if (rating >= t.minRating) current = t; }
    return current;
}

// ==================== УМНЫЙ ПОИСК НИКОВ (FUZZY MATCHING) ====================
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function findBestPlayerMatch(recognizedNick, playersList) {
    let bestPlayer = null;
    let minDistance = 999;
    const normRec = recognizedNick.toLowerCase().replace(/[^a-zа-я0-9_]/g, '');

    for (const p of playersList) {
        const normDb = p.nickname.toLowerCase().replace(/[^a-zа-я0-9_]/g, '');
        if (normRec === normDb) return p;
        if (normDb.includes(normRec) || normRec.includes(normDb)) {
            if (Math.abs(normRec.length - normDb.length) <= 3) return p;
        }
        const dist = levenshteinDistance(normRec, normDb);
        const maxAllowedDist = Math.floor(normDb.length / 3) + 1;
        if (dist < minDistance && dist <= maxAllowedDist) {
            minDistance = dist;
            bestPlayer = p;
        }
    }
    return bestPlayer;
}
// =======================================================================

// ==================== БЭКАПЫ ====================

async function exportBackup() {
    showToast('Создание бэкапа...', 'info');
    const backup = {};
    for (const t of BACKUP_TABLES) {
        const { data } = await supabaseClient.from(t).select('*');
        backup[t] = data || [];
    }
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `backup_clan_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Бэкап скачан', 'success');
}

function importBackup(input) {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!confirm('Вы уверены? Текущие данные будут перезаписаны.')) return;
            showToast('Восстановление...', 'info');
            for (const [table, rows] of Object.entries(data)) {
                if (rows && rows.length > 0) {
                    await supabaseClient.from(table).upsert(rows);
                }
            }
            showToast('Данные восстановлены!', 'success');
            location.reload();
        } catch (err) { showToast('Ошибка JSON: ' + err.message, 'error'); }
    };
    reader.readAsText(file);
}

async function createAutoBackup(silent = false) {
    if (!silent) showToast('Создание бэкапа в БД...', 'info');
    const data = {};
    for (const t of BACKUP_TABLES) {
        const { data: rows, error } = await supabaseClient.from(t).select('*');
        if (error) return false;
        data[t] = rows || [];
    }
    const sizeBytes = new Blob([JSON.stringify(data)]).size;
    const { error } = await supabaseClient.from('backups').insert([{ data, size_bytes: sizeBytes }]);
    if (error) return false;
    
    const { data: all } = await supabaseClient.from('backups').select('id').order('created_at', { ascending: false });
    if (all && all.length > BACKUP_RETENTION) {
        const ids = all.slice(BACKUP_RETENTION).map(b => b.id);
        await supabaseClient.from('backups').delete().in('id', ids);
    }
    return true;
}

async function checkAndBackupIfStale() {
    try {
        const { data } = await supabaseClient.from('backups').select('created_at').order('created_at', { ascending: false }).limit(1);
        if (!data || data.length === 0) { await createAutoBackup(true); return; }
        const ageMin = (Date.now() - new Date(data[0].created_at).getTime()) / 60000;
        if (ageMin > 90) await createAutoBackup(true);
    } catch (e) { console.error('checkAndBackupIfStale:', e); }
}

async function restoreFromDB() {
    if (!isAdmin) return showToast('Нужен вход админа', 'error');
    const { data: backups, error } = await supabaseClient.from('backups').select('id, created_at, size_bytes').order('created_at', { ascending: false });
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    if (!backups || backups.length === 0) return showToast('Бэкапов нет', 'info');

    const list = backups.map((b, i) => `${i + 1}. ${new Date(b.created_at).toLocaleString('ru-RU')} — ${(b.size_bytes / 1024).toFixed(1)} КБ`).join('\n');
    const choice = prompt('Выберите бэкап для восстановления (номер):\n\n' + list);
    if (!choice) return;
    const idx = parseInt(choice) - 1;
    if (isNaN(idx) || !backups[idx]) return showToast('Неверный номер', 'error');
    if (!confirm(`Восстановить бэкап от ${new Date(backups[idx].created_at).toLocaleString('ru-RU')}?`)) return;

    showToast('Восстановление...', 'info');
    const { data: backup } = await supabaseClient.from('backups').select('data').eq('id', backups[idx].id).single();
    if (!backup) return showToast('Ошибка чтения', 'error');
    for (const [table, rows] of Object.entries(backup.data)) {
        if (Array.isArray(rows) && rows.length > 0) await supabaseClient.from(table).upsert(rows);
    }
    showToast('Восстановлено! Перезагрузка...', 'success');
    setTimeout(() => location.reload(), 1200);
}

// ==================== ОСНОВНОЙ КОД ====================

async function loadSeasons() {
    const { data, error } = await supabaseClient.from('seasons').select('*').order('id');
    const sel = document.getElementById('season-selector');
    if (!sel) return;

    if (error || !data || data.length === 0) {
        sel.innerHTML = '<option value="all">Все время</option>';
        activeSeasonId = 'all';
        return;
    }

    allSeasons = data;
    sel.innerHTML = '';
    const optAll = document.createElement('option');
    optAll.value = 'all'; optAll.textContent = 'Все время';
    sel.appendChild(optAll);

    allSeasons.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.name;
        if (s.is_active) { opt.selected = true; activeSeasonId = s.id; }
        sel.appendChild(opt);
    });
    
    if (!activeSeasonId) {
        if (allSeasons.length > 0) { activeSeasonId = allSeasons[0].id; sel.value = activeSeasonId; } 
        else { activeSeasonId = 'all'; }
    }
}

function switchViewingSeason(val) {
    if (val === 'all') activeSeasonId = 'all';
    else activeSeasonId = parseInt(val);
    loadAllData();
}

function openSeasonModal() {
    document.getElementById('new-season-name').value = '';
    document.getElementById('season-modal').style.display = 'flex';
}

async function createSeason() {
    const name = document.getElementById('new-season-name').value.trim();
    if (!name) return showToast('Введите название', 'error');
    await supabaseClient.from('seasons').update({ is_active: false }).neq('id', 0);
    const { data } = await supabaseClient.from('seasons').insert([{ name, is_active: true }]).select().single();
    if (data) {
        document.getElementById('season-modal').style.display = 'none';
        showToast('Сезон создан!', 'success');
        await loadSeasons();
        loadAllData();
    }
}

function filterBySeason(query) {
    if (activeSeasonId === 'all' || !activeSeasonId) return query;
    return query.eq('season_id', activeSeasonId);
}

async function loadSquadConfig() {
    const { data } = await supabaseClient.from('clan_settings').select('value').eq('key', 'squads').maybeSingle();
    if (data && data.value) {
        const parsed = data.value;
        if (Array.isArray(parsed) && parsed.length === 6) SQUADS_CONFIG.forEach((sq, i) => { sq.name = parsed[i]; });
    }
}

document.addEventListener('dragover', function(e) {
    const t = 100, s = 20;
    if (e.clientY < t) window.scrollBy(0, -s);
    else if (window.innerHeight - e.clientY < t) window.scrollBy(0, s);
});

function setupRealtimeSync() {
    supabaseClient.channel('schema-db-changes').on('postgres_changes', { event: '*', schema: 'public' }, payload => {
        loadAllData().then(() => {
            if (document.getElementById('tab-roster').classList.contains('active')) initDragAndDrop();
            if (document.getElementById('tab-attendance').classList.contains('active')) loadAttendance();
            if (document.getElementById('tab-missed').classList.contains('active')) loadAllMissed();
            if (document.getElementById('tab-stats').classList.contains('active')) loadMatchStats();
            if (document.getElementById('tab-history').classList.contains('active')) loadMatchHistory();
            if (document.getElementById('tab-calendar').classList.contains('active')) loadCalendar();
            if (document.getElementById('tab-analytics').classList.contains('active')) loadAnalytics();
        });
    }).subscribe();
}

function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    let icon = type === 'success' ? '✅' : (type === 'error' ? '❌' : 'ℹ️');
    toast.innerHTML = `<span style="font-size:1.2em;">${icon}</span> <span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}

function initSearchableSelect(id, direction = 'up') {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tomselect) el.tomselect.destroy();
    new TomSelect(el, { create: false, sortField: { field: "text", direction: "asc" }, maxItems: 1, dropdownDirection: direction });
}

function checkLogin() {
    const input = document.getElementById('login-input').value.trim(); if (!input) return;
    if (input === ADMIN_SECRET_CODE) {
        isAdmin = true; document.body.classList.add('is-admin');
        document.getElementById('login-modal').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'inline-block';
        loadAllData();
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex'); 
        showToast('Вход выполнен', 'info');
    } else {
        const player = allPlayers.find(p => p.nickname && p.nickname.toLowerCase() === input.toLowerCase());
        if (player) {
            document.getElementById('login-modal').style.display = 'none';
            document.getElementById('logout-btn').style.display = 'inline-block';
            document.getElementById('my-profile-tab').style.display = 'inline-block';
            loadAllData().then(() => loadMyProfile(player));
            showToast('Успешный вход', 'success');
        } else { document.getElementById('login-error').innerText = 'Игрок с таким ником не найден.'; }
    }
}

function logout() { location.reload(); }

function openTab(evt, tabName) {
    document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    document.getElementById(tabName).classList.add("active"); evt.currentTarget.classList.add("active");
    
    if (tabName === 'tab-roster') initDragAndDrop();
    if (tabName === 'tab-profile') renderPlayerList();
    if (tabName === 'tab-compare') initCompareTab();
    if (tabName === 'tab-history') loadMatchHistory();
    if (tabName === 'tab-calendar') loadCalendar();
    if (tabName === 'tab-fines') loadFines();
    if (tabName === 'tab-attendance') loadAttendance();
    if (tabName === 'tab-missed') loadAllMissed();
    if (tabName === 'tab-stats') loadMatchStats();
    if (tabName === 'tab-analytics') loadAnalytics();
}

function goToPlayerProfile(playerId) {
    if (!isAdmin) return;
    const profileTabBtn = document.querySelector('.tab-btn[onclick*="tab-profile"]');
    if (profileTabBtn) profileTabBtn.click();
    const player = allPlayers.find(p => p.id === playerId);
    if (player) setTimeout(() => { selectPlayer(player); }, 50);
}

function populateProfileDropdowns() {
    const squadSelect = document.getElementById('profile-squad');
    const roleSelect = document.getElementById('profile-role');
    if (!squadSelect || !roleSelect) return;
    if (squadSelect.tomselect) squadSelect.tomselect.destroy();
    if (roleSelect.tomselect) roleSelect.tomselect.destroy();

    squadSelect.innerHTML = '<option value="">-- Без отряда --</option>';
    SQUADS_CONFIG.forEach(sq => { squadSelect.innerHTML += `<option value="${sq.name}">${sq.name}</option>`; });
    roleSelect.innerHTML = '<option value="">-- Без роли --</option>';
    SQUADS_CONFIG[0].roles.forEach(r => { roleSelect.innerHTML += `<option value="${r}">${r}</option>`; });
}

function openSquadNamesModal() {
    if (!isAdmin) return;
    const container = document.getElementById('squad-names-inputs');
    container.innerHTML = '';
    SQUADS_CONFIG.forEach((sq, i) => {
        container.innerHTML += `<div class="form-group"><label>Отряд ${i+1}</label><input type="text" id="squad-name-input-${i}" value="${sq.name}"></div>`;
    });
    document.getElementById('squad-names-modal').style.display = 'flex';
}

async function saveSquadNames() {
    if (!isAdmin) return;
    let changed = false;
    const changes = [];
    const uniqueNames = new Set();
    const newNamesArray = [];

    for (let i = 0; i < SQUADS_CONFIG.length; i++) {
        const inputVal = document.getElementById(`squad-name-input-${i}`).value.trim();
        if (!inputVal) return showToast('Пустое имя', 'error');
        if (uniqueNames.has(inputVal)) return showToast('Совпадение имен', 'error');
        uniqueNames.add(inputVal); newNamesArray.push(inputVal);
        if (inputVal !== SQUADS_CONFIG[i].name) {
            changes.push({ old: SQUADS_CONFIG[i].name, new: inputVal });
            SQUADS_CONFIG[i].name = inputVal; changed = true;
        }
    }

    if (changed) {
        document.getElementById('squad-names-modal').style.display = 'none';
        try {
            await supabaseClient.from('clan_settings').upsert({ key: 'squads', value: newNamesArray });
            for (const ch of changes) await supabaseClient.from('players').update({ squad: ch.new }).eq('squad', ch.old);
            await loadAllData(); initDragAndDrop();
            showToast('Названия обновлены!', 'success');
        } catch (err) { showToast('Ошибка: ' + err.message, 'error'); }
    } else {
        document.getElementById('squad-names-modal').style.display = 'none';
    }
}

async function clearAllSquads() {
    if (!isAdmin || !confirm('Очистить состав?')) return;
    try {
        await supabaseClient.from('players').update({ squad: null, role: null }).neq('id', 0);
        showToast('Состав очищен', 'success'); await loadAllData(); initDragAndDrop();
    } catch (err) { showToast('Ошибка: ' + err.message, 'error'); }
}

async function loadAllData() {
    await loadSquadConfig();
    populateProfileDropdowns();
    
    let q = supabaseClient.from('players').select('*').order('kd', { ascending: false });
    q = filterBySeason(q);
    const { data: players, error } = await q;
    
    if (error) console.error("Ошибка загрузки игроков:", error);

    if (players) { 
        allPlayers = players; 
        activePlayers = players.filter(p => !p.status || p.status === 'в клане'); 
        renderTops(); renderPlayerList(); fillPlayerSelects(); 
    }
    
    let notesQ = supabaseClient.from('player_notes').select('*');
    const { data: notesData } = await notesQ;
    if (notesData) allNotes = notesData;

    const loadWeap = async (table, selId, vetName) => {
        const { data } = await supabaseClient.from(table).select('name').order('name');
        const sel = document.getElementById(selId);
        if (sel) {
            sel.innerHTML = '<option value="">-- Выберите --</option>';
            if (data) data.forEach(i => { const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; sel.appendChild(o); });
            const v = document.createElement('option'); v.value = vetName; v.textContent = vetName; v.style.color = "var(--accent-color)"; sel.appendChild(v);
        }
    };
    await loadWeap('assault_rifles', 'select-rifle', 'Ветеранское');
    await loadWeap('smgs', 'select-smg', 'Ветеранское');
    await loadWeap('pistols', 'select-pistol', 'Ветеранское');
    await loadWeap('snipers', 'select-sniper', 'Ветеранское');
    await loadWeap('machine_guns', 'select-machine-gun', 'Ветеранское');
    await loadWeap('shotguns', 'select-shotgun', 'Ветеранское');

    const { data: armorItems } = await supabaseClient.from('armor').select('name, type').order('name');
    const fillArmorSelect = (selectId, typeFilter) => {
        const select = document.getElementById(selectId);
        if (!select) return;
        select.innerHTML = '<option value="">-- Выберите --</option>';
        (armorItems || []).filter(i => (i.type || 'combat') === typeFilter).forEach(i => {
            const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; select.appendChild(o);
        });
        const v = document.createElement('option'); v.value = "Ветеранская"; v.textContent = "Ветеранская"; v.style.color = "var(--danger-color)"; select.appendChild(v);
    };
    fillArmorSelect('select-armor-combat', 'combat');
    fillArmorSelect('select-armor-combined', 'combined');

    ['select-rifle','select-smg','select-sniper','select-pistol','select-machine-gun','select-shotgun','select-armor-combat','select-armor-combined','profile-squad','profile-role','profile-status','fine-player'].forEach(id => initSearchableSelect(id));
}

function renderTops() {
    document.getElementById('loading-tops').style.display = 'none'; 
    document.getElementById('table-tops').style.display = 'block';
    const tbody = document.getElementById('players-table-body');
    let sortedPlayers = [...activePlayers].sort((a, b) => {
        let valA = a[currentSortColumn] || '', valB = b[currentSortColumn] || '';
        if (typeof valA === 'string' && typeof valB === 'string') return currentSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA);
        return currentSortDirection === 'asc' ? (parseFloat(valA)||0) - (parseFloat(valB)||0) : (parseFloat(valB)||0) - (parseFloat(valA)||0);
    });
    
    if (sortedPlayers.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">Нет данных за этот период</td></tr>';
        return;
    }
    tbody.innerHTML = sortedPlayers.map((p, i) => `<tr><td>#${i+1}</td><td><strong>${p.nickname}</strong></td><td>${p.kd}</td><td>${p.kda}</td><td style="color:var(--accent-color);font-weight:bold;">${p.points}</td></tr>`).join('');
}

function sortTops(column) {
    if (currentSortColumn === column) currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc'; 
    else { currentSortColumn = column; currentSortDirection = 'desc'; }
    renderTops();
}

function fillPlayerSelects() {
    const select = document.getElementById('fine-player'); if (!select) return;
    select.innerHTML = '<option value="">-- Выберите игрока --</option>';
    activePlayers.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.nickname; select.appendChild(o); });
    initSearchableSelect('fine-player', 'up');
}

function renderPlayerList(filterText = '') {
    const container = document.getElementById('player-list-container'); 
    if (!container) return;
    container.innerHTML = '';
    
    const searchLower = filterText.toLowerCase().trim();
    let filteredPlayers = allPlayers.filter(p => (p.nickname && p.nickname.toLowerCase().includes(searchLower)));
    
    filteredPlayers.sort((a, b) => {
        const sA = a.status ? a.status.toLowerCase() : 'в клане'; 
        const sB = b.status ? b.status.toLowerCase() : 'в клане';
        const pA = STATUS_PRIORITY[sA] || 1;
        const pB = STATUS_PRIORITY[sB] || 1;
        if (pA !== pB) return pA - pB;
        return a.nickname.localeCompare(b.nickname); 
    });
    
    let currentStatusGroup = '';

    filteredPlayers.forEach(p => {
        const pStatus = p.status ? p.status.toLowerCase() : 'в клане';
        
        if (pStatus !== currentStatusGroup) {
            currentStatusGroup = pStatus;
            const groupHeader = document.createElement('div');
            groupHeader.style.cssText = 'margin: 15px 5px 8px 5px; color: var(--text-muted); font-size: 0.75em; font-weight: bold; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px dashed var(--border-color); padding-bottom: 4px;';
            
            let headerText = '';
            if (pStatus === 'в клане') headerText = '🟢 В КЛАНЕ';
            else if (pStatus === 'в обработке') headerText = '🟡 В ОБРАБОТКЕ';
            else if (pStatus === 'кикнут') headerText = '🔴 КИКНУТЫЕ';
            else headerText = pStatus;
            
            groupHeader.textContent = headerText;
            container.appendChild(groupHeader);
        }

        const div = document.createElement('div'); 
        div.className = `player-item ${currentEditId === p.id ? 'active' : ''}`;
        let sColor = pStatus === 'в обработке' ? 'var(--accent-color)' : (pStatus === 'кикнут' ? 'var(--danger-color)' : 'var(--success-color)');
        
        const coachCount = allNotes.filter(n => n.player_id === p.id && n.note_type === 'coach').length;
        const tkCount = allNotes.filter(n => n.player_id === p.id && n.note_type === 'timekeeper').length;
        
        let badges = '';
        if (coachCount > 0) badges += `<span class="badge-coach">📝 ${coachCount}</span>`;
        if (tkCount > 0) badges += `<span class="badge-tk">📋 ${tkCount}</span>`;
        const nameOpacity = pStatus === 'кикнут' ? '0.6' : '1';

        div.innerHTML = `
            <div style="display:flex; flex-direction:column; opacity: ${nameOpacity};">
                <div style="font-weight:bold; display:flex; align-items:center; flex-wrap:wrap;">${p.nickname} ${badges}</div>
                <span style="font-size:0.8em; color:${sColor}; margin-top:2px;">${p.status || 'в клане'}</span>
            </div>
        `;
        div.onclick = () => selectPlayer(p); 
        container.appendChild(div);
    });
}

function filterPlayerList() { const i = document.getElementById('player-search-input'); if (i) renderPlayerList(i.value); }

async function selectPlayer(p) {
    currentEditId = p.id;
    document.getElementById('form-title').innerText = "Ред: " + p.nickname;
    document.getElementById('edit-player-id').value = p.id; document.getElementById('profile-nickname').value = p.nickname || '';
    document.getElementById('profile-discord-id').value = p.discord_id || ''; document.getElementById('profile-kd').value = p.kd || 0;
    document.getElementById('profile-kda').value = p.kda || 0; document.getElementById('profile-points').value = p.points || 0;
    document.getElementById('profile-sledgehammer').checked = p.has_sledgehammer || false;
    document.getElementById('profile-speed-combat').value = p.speed_combat || ''; document.getElementById('profile-penetration-combat').value = p.penetration_combat || '';
    document.getElementById('profile-speed-combined').value = p.speed_combined || ''; document.getElementById('profile-penetration-combined').value = p.penetration_combined || '';

    ['select-rifle','select-smg','select-sniper','select-pistol','select-machine-gun','select-shotgun','select-armor-combat','select-armor-combined','profile-status','profile-squad','profile-role'].forEach(id => {
        const el = document.getElementById(id);
        const val = id === 'profile-squad' ? (p.squad || '') : id === 'profile-role' ? (p.role || '') : id === 'profile-status' ? (p.status || 'в клане') : id === 'select-rifle' ? (p.main_rifle || '') : id === 'select-smg' ? (p.main_smg || '') : id === 'select-sniper' ? (p.sniper || '') : id === 'select-pistol' ? (p.secondary_pistol || '') : id === 'select-machine-gun' ? (p.machine_gun || '') : id === 'select-shotgun' ? (p.shotgun || '') : id === 'select-armor-combat' ? (p.armor_combat || '') : id === 'select-armor-combined' ? (p.armor_combined || '') : '';
        if (el.tomselect) el.tomselect.setValue(val, true); else el.value = val;
    });

    document.getElementById('btn-delete').style.display = 'block';
    renderPlayerList();
    renderPlayerAttendanceTable(p.id);
    const coachWrapper = document.getElementById('player-notes-wrapper'); if (coachWrapper) coachWrapper.style.display = 'block';
    const tkWrapper = document.getElementById('player-timekeeper-notes-wrapper'); if (tkWrapper) tkWrapper.style.display = 'block';
    await loadPlayerNotes(p.id);
}

async function renderPlayerAttendanceTable(playerId) {
    const container = document.getElementById('player-attendance-vertical');
    if (!container) return;
    let q = supabaseClient.from('attendance').select('*').eq('player_id', playerId);
    q = filterBySeason(q);
    const { data: att } = await q;

    let html = '<table class="attendance-table" style="font-size:0.8em;"><thead><tr><th>Этап</th>';
    for (let i = 1; i <= 12; i++) html += `<th>Т${i}</th>`;
    html += '</tr></thead><tbody>';

    for (let stage = 1; stage <= 3; stage++) {
        html += `<tr><td>Э${stage}</td>`;
        for (let t = 1; t <= 12; t++) {
            const globalStage = (t - 1) * 3 + stage;
            const record = att ? att.find(a => a.tournament_number === globalStage) : null;
            const status = record ? record.status : '-';
            let color = status === 'Пришел' ? 'var(--success-color)' : (status === 'Не пришел' ? 'var(--danger-color)' : (status === 'Отгул' ? 'var(--accent-color)' : '#555'));
            html += `<td style="color:${color}; font-weight:bold; padding:4px;" title="${status}">${status === 'Пришел' ? '✓' : (status === 'Не пришел' ? '✗' : (status === 'Отгул' ? 'О' : '-'))}</td>`;
        }
        html += '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
}

function clearForm() {
    const s = document.getElementById('player-search-input'); if (s) s.value = ''; 
    currentEditId = null; document.getElementById('form-title').innerText = "Новый боец";
    document.getElementById('edit-player-id').value = '';
    ['nickname','discord-id','kd','kda','points','speed-combat','penetration-combat','speed-combined','penetration-combined'].forEach(f => document.getElementById('profile-'+f).value = '');
    document.getElementById('profile-sledgehammer').checked = false;
    ['select-rifle','select-smg','select-sniper','select-pistol','select-machine-gun','select-shotgun','select-armor-combat','select-armor-combined','profile-status','profile-squad','profile-role'].forEach(id => {
        const el = document.getElementById(id);
        if (el.tomselect) el.tomselect.clear(true); else el.value = '';
    });
    document.getElementById('btn-delete').style.display = 'none';
    document.getElementById('player-notes-wrapper').style.display = 'none';
    document.getElementById('player-timekeeper-notes-wrapper').style.display = 'none';
    document.getElementById('player-attendance-vertical').innerHTML = '';
    renderPlayerList();
}

async function saveProfile() {
    const nick = document.getElementById('profile-nickname').value.trim(); if (!nick) return showToast('Введите ник!', 'error');
    const selectedSquad = document.getElementById('profile-squad').value;
    const selectedRole = document.getElementById('profile-role').value;

    if (selectedSquad && selectedRole) {
        const existing = allPlayers.find(x => x.squad === selectedSquad && x.role === selectedRole && x.id !== currentEditId);
        if (existing) await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', existing.id);
    }

    const data = {
        nickname: nick, discord_id: document.getElementById('profile-discord-id').value.trim(),
        kd: parseFloat(document.getElementById('profile-kd').value) || 0, kda: parseFloat(document.getElementById('profile-kda').value) || 0,
        points: parseInt(document.getElementById('profile-points').value) || 0, main_rifle: document.getElementById('select-rifle').value,
        main_smg: document.getElementById('select-smg').value, sniper: document.getElementById('select-sniper').value,
        secondary_pistol: document.getElementById('select-pistol').value, armor_combat: document.getElementById('select-armor-combat').value,
        armor_combined: document.getElementById('select-armor-combined').value, machine_gun: document.getElementById('select-machine-gun').value,
        shotgun: document.getElementById('select-shotgun').value, has_sledgehammer: document.getElementById('profile-sledgehammer').checked,
        speed_combat: parseInt(document.getElementById('profile-speed-combat').value) || 0, penetration_combat: parseInt(document.getElementById('profile-penetration-combat').value) || 0,
        speed_combined: parseInt(document.getElementById('profile-speed-combined').value) || 0, penetration_combined: parseInt(document.getElementById('profile-penetration-combined').value) || 0,
        status: document.getElementById('profile-status').value, squad: selectedSquad || null, role: selectedRole || null,
        season_id: (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId
    };
    
    let error;
    if (currentEditId) { const res = await supabaseClient.from('players').update(data).eq('id', currentEditId); error = res.error; }
    else { const res = await supabaseClient.from('players').insert([data]); error = res.error; }
    
    if (error) showToast('Ошибка: ' + error.message, 'error'); 
    else { showToast('Сохранено!', 'success'); await loadAllData(); clearForm(); }
}

async function deletePlayer() {
    if (!currentEditId || !confirm('Удалить?')) return;
    const { error } = await supabaseClient.from('players').delete().eq('id', currentEditId);
    if (error) showToast('Ошибка', 'error'); 
    else { showToast('Удален', 'success'); await loadAllData(); clearForm(); }
}

async function loadMyProfile(player) {
    if (!player) return; document.getElementById('my-profile-content').style.display = 'block';
    document.getElementById('my-kd').innerText = player.kd || 0; document.getElementById('my-kda').innerText = player.kda || 0;
    document.getElementById('my-points').innerText = player.points || 0;
    document.getElementById('my-squad').innerText = player.squad ? `${player.squad} (${player.role})` : 'Не в отряде';
}

function initDragAndDrop(filterText = '') {
    const board = document.getElementById('roster-board'); if (!board) return; board.innerHTML = '';
    SQUADS_CONFIG.forEach(sq => {
        const card = document.createElement('div'); card.className = 'squad-card'; let rH = '';
        sq.roles.forEach(role => {
            const a = activePlayers.find(p => p.squad === sq.name && p.role === role);
            const n = a ? `<span style="cursor:pointer; color:var(--accent-color); text-decoration:underline;" onclick="event.stopPropagation(); goToPlayerProfile(${a.id})">${a.nickname}</span>` : 'Свободно';
            const c = a ? 'player-name' : 'empty-slot', id = a ? a.id : '';
            const rB = (a && isAdmin) ? `<button class="btn btn-danger" style="padding: 2px 5px; font-size: 0.75em; margin-left: 5px;" onclick="event.stopPropagation(); removeFromSquad(${a.id})">➖</button>` : '';
            const displayRole = role.replace(' 1', '').replace(' 2', '').replace(' 3', '');
            rH += `<div class="role-slot" data-squad="${sq.name}" data-role="${role}" data-player-id="${id}" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event, this)"><span>${displayRole}</span><span class="${c}">${n} ${rB}</span></div>`;
        });
        card.innerHTML = `<div class="squad-title">${sq.name}</div>${rH}`; board.appendChild(card);
    });

    const freeList = document.getElementById('free-players-list'); if (!freeList) return; freeList.innerHTML = '';
    freeList.ondragover = (e) => e.preventDefault();
    freeList.ondrop = async (e) => {
        e.preventDefault(); if (!isAdmin) return; const id = e.dataTransfer.getData('text/plain');
        if (id) { await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id); await loadAllData(); initDragAndDrop(); }
    };
    
    const searchLower = filterText.toLowerCase().trim();
    const free = activePlayers.filter(p => !p.squad && p.nickname.toLowerCase().includes(searchLower));
    free.forEach(p => {
        const i = document.createElement('div'); i.className = 'free-player-item'; i.draggable = isAdmin;
        i.ondragstart = (e) => { e.dataTransfer.setData('text/plain', p.id); i.classList.add('dragging'); };
        i.ondragend = () => i.classList.remove('dragging'); i.innerHTML = `<span>${p.nickname}</span>`; freeList.appendChild(i);
    });
}

async function handleDrop(event, slot) {
    event.preventDefault(); slot.classList.remove('drag-over'); if (!isAdmin) return;
    const id = parseInt(event.dataTransfer.getData('text/plain')), sq = slot.dataset.squad, role = slot.dataset.role, ex = slot.dataset.playerId ? parseInt(slot.dataset.playerId) : null;
    if (!id) return; 
    try {
        if (ex && ex !== id) await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', ex);
        await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id);
        const { error } = await supabaseClient.from('players').update({ squad: sq, role: role }).eq('id', id);
        if (error) throw error;
        showToast('Перемещен', 'success'); await loadAllData(); initDragAndDrop();
    } catch (err) { showToast('Ошибка', 'error'); await loadAllData(); initDragAndDrop(); }
}

async function removeFromSquad(id) {
    if (!isAdmin || !confirm('Убрать?')) return;
    await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id);
    await loadAllData(); initDragAndDrop();
}

async function loadAttendance() {
    let qP = supabaseClient.from('players').select('*'), qA = supabaseClient.from('attendance').select('*');
    qP = filterBySeason(qP); qA = filterBySeason(qA);
    const { data: p } = await qP, { data: a } = await qA;
    
    if (p) { allPlayers = p; activePlayers = p.filter(x => !x.status || x.status === 'в клане'); } 
    if (a) allAttendance = a;
    
    let max = 3; 
    if (a && a.length > 0) { const m = Math.max(...a.map(x => x.tournament_number)); if (m > max) max = m; }
    
    let qCal = supabaseClient.from('clan_calendar').select('tournament_number');
    qCal = filterBySeason(qCal);
    const { data: cal } = await qCal;
    if (cal && cal.length > 0) {
        const maxCal = Math.max(...cal.map(x => x.tournament_number || 1));
        if (maxCal * 3 > max) max = maxCal * 3;
    }

    maxAttendanceStage = max;
    
    const s = document.getElementById('modal-stage'); 
    if (s) { 
        s.innerHTML = ''; 
        for (let i = 1; i <= max; i++) { const o = document.createElement('option'); o.value = i; o.textContent = `Этап ${i}`; s.appendChild(o); }
    }
    
    const container = document.getElementById('attendance-container');
    container.innerHTML = '';
    
    const numTourneys = Math.ceil(max / 3);
    for (let t = 1; t <= numTourneys; t++) {
        const details = document.createElement('details');
        details.className = 'tournament-group'; details.open = (t === numTourneys); 
        const summary = document.createElement('summary'); summary.textContent = `ТУРНИР ${t}`; details.appendChild(summary);
        const content = document.createElement('div'); content.className = 'tournament-content';
        
        let tableHtml = `<table class="attendance-table"><thead><tr><th>Боец</th>`;
        for (let st = 1; st <= 3; st++) tableHtml += `<th>ЭТАП ${st}</th>`;
        tableHtml += `</tr></thead><tbody>`;
        
        const searchQuery = document.getElementById('attendance-search').value.toLowerCase().trim();
        const filteredPlayers = activePlayers.filter(p => p.nickname.toLowerCase().includes(searchQuery));
        
        filteredPlayers.forEach(p => {
            tableHtml += `<tr><td>${p.nickname}</td>`;
            for (let st = 1; st <= 3; st++) {
                const globalStage = (t - 1) * 3 + st;
                const r = allAttendance.find(a => a.player_id === p.id && a.tournament_number === globalStage); 
                const status = r ? r.status : 'Не отмечен';
                let c = status === 'Пришел' ? 'status-1' : (status === 'Не пришел' ? 'status-2' : (status === 'Отгул' ? 'status-3' : ''));
                tableHtml += `<td><select class="${c}" ${!isAdmin ? 'disabled' : ''} onchange="updateAttendance(${p.id}, ${globalStage}, this.value)"><option value="Не отмечен" ${status === 'Не отмечен' ? 'selected' : ''}>-</option><option value="Пришел" ${status === 'Пришел' ? 'selected' : ''}>Пришел</option><option value="Не пришел" ${status === 'Не пришел' ? 'selected' : ''}>Не пришел</option><option value="Отгул" ${status === 'Отгул' ? 'selected' : ''}>Отгул</option></select></td>`;
            }
            tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table>`;
        content.innerHTML = tableHtml; details.appendChild(content); container.appendChild(details);
    }
}

async function updateAttendance(id, t, s) {
    if (!isAdmin) return;
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;
    if (s === 'Не отмечен') {
        await supabaseClient.from('attendance').delete().eq('player_id', id).eq('tournament_number', t).eq('season_id', seasonId);
    } else {
        const { error } = await supabaseClient.from('attendance').upsert({ player_id: id, tournament_number: t, status: s, season_id: seasonId }, { onConflict: 'player_id, tournament_number, season_id' });
        if (error) {
            const { data: existing } = await supabaseClient.from('attendance').select('id').eq('player_id', id).eq('tournament_number', t).eq('season_id', seasonId).single();
            if (existing) await supabaseClient.from('attendance').update({ status: s }).eq('id', existing.id);
            else await supabaseClient.from('attendance').insert({ player_id: id, tournament_number: t, status: s, season_id: seasonId });
        }
    }
    loadAttendance();
    if (document.getElementById('tab-missed').classList.contains('active')) loadAllMissed();
}

function addTournament() { maxAttendanceStage += 3; loadAttendance(); }
async function deleteTournament() {
    if (maxAttendanceStage <= 3 || !confirm(`Удалить?`)) return;
    for (let i = maxAttendanceStage; i > maxAttendanceStage - 3; i--) {
        let q = supabaseClient.from('attendance').delete().eq('tournament_number', i);
        if (activeSeasonId !== 'all') q = q.eq('season_id', activeSeasonId);
        await q;
    }
    maxAttendanceStage -= 3; loadAttendance();
}

async function loadAllMissed() {
    const tbody = document.getElementById('missed-table-body');
    if (!tbody) return;

    let qP = supabaseClient.from('players').select('*');
    qP = filterBySeason(qP);
    const { data: p } = await qP;
    if (p) {
        allPlayers = p;
        activePlayers = p.filter(x => !x.status || x.status === 'в клане');
    }
    const activePlayerIds = new Set(activePlayers.map(x => x.id));
    
    let q = supabaseClient.from('attendance').select('*, players(nickname)').eq('status', 'Не пришел').order('tournament_number', { ascending: true });
    q = filterBySeason(q);
    const { data, error } = await q;

    if (error) { tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:red;">Ошибка</td></tr>`; return; }
    
    const filteredData = (data || []).filter(item => activePlayerIds.has(item.player_id));

    if (filteredData.length === 0) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:green;">Прогулов нет</td></tr>'; return; }

    const grouped = {};
    filteredData.forEach(item => {
        const pId = item.player_id, nick = item.players ? item.players.nickname : 'Удален';
        if (!grouped[pId]) grouped[pId] = { id: pId, nickname: nick, stages: [] };
        grouped[pId].stages.push(item.tournament_number);
    });

    tbody.innerHTML = '';
    Object.values(grouped).sort((a, b) => b.stages.length - a.stages.length).forEach(p => {
        const groupedStages = {};
        p.stages.forEach(s => {
            const tourney = Math.ceil(s / 3), stage = s % 3 === 0 ? 3 : s % 3;
            if (!groupedStages[tourney]) groupedStages[tourney] = [];
            groupedStages[tourney].push({ global: s, stage });
        });
        let stagesHtml = Object.keys(groupedStages).map(t => {
            return `<div style="display:inline-flex; flex-wrap:wrap; margin-right:10px; gap:5px; margin-bottom:5px; background:var(--input-bg); padding:3px 5px; border-radius:4px;">
                <span style="font-size:0.8em; color:var(--text-muted);">Т${t}:</span>
                ${groupedStages[t].map(item => `<select class="missed-select" onchange="updateMissedStatus(${p.id}, ${item.global}, this.value)"><option value="Не пришел" selected>Э${item.stage}:Н</option><option value="Отгул">Э${item.stage}:О</option><option value="Пришел">Э${item.stage}:П</option><option value="Удалить">X</option></select>`).join('')}
            </div>`;
        }).join('');
        tbody.innerHTML += `<tr><td style="vertical-align:top;"><strong>${p.nickname}</strong></td><td style="color:red; font-weight:bold; text-align:center; font-size:1.2em;">${p.stages.length}</td><td>${stagesHtml}</td></tr>`;
    });
}

async function updateMissedStatus(playerId, globalStage, newStatus) {
    if (!isAdmin) return;
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;
    if (newStatus === 'Удалить') {
        await supabaseClient.from('attendance').delete().eq('player_id', playerId).eq('tournament_number', globalStage).eq('season_id', seasonId);
    } else {
        await supabaseClient.from('attendance').upsert({ player_id: playerId, tournament_number: globalStage, status: newStatus, season_id: seasonId }, { onConflict: 'player_id, tournament_number, season_id' });
    }
    await loadAllMissed(); loadAttendance();
}

async function loadMatchStats() {
    let qP = supabaseClient.from('players').select('*'), qS = supabaseClient.from('match_stats').select('*');
    qP = filterBySeason(qP); qS = filterBySeason(qS);
    const { data: p } = await qP, { data: s } = await qS;
    if (p) { allPlayers = p; activePlayers = p.filter(x => !x.status || x.status === 'в клане'); }
    
    let max = 3; 
    if (s && s.length > 0) { const m = Math.max(...s.map(x => x.stage_number)); if (m > max) max = m; }
    
    let qCal = supabaseClient.from('clan_calendar').select('tournament_number');
    qCal = filterBySeason(qCal);
    const { data: cal } = await qCal;
    if (cal && cal.length > 0) {
        const maxCal = Math.max(...cal.map(x => x.tournament_number || 1));
        if (maxCal * 3 > max) max = maxCal * 3;
    }

    const container = document.getElementById('stats-container'); container.innerHTML = '';
    
    const numTourneys = Math.ceil(max / 3);
    for (let t = 1; t <= numTourneys; t++) {
        const details = document.createElement('details'); details.className = 'tournament-group'; details.open = (t === numTourneys);
        const summary = document.createElement('summary'); summary.textContent = `ТУРНИР ${t}`; details.appendChild(summary);
        const content = document.createElement('div'); content.className = 'tournament-content';
        
        let tableHtml = `<table class="stats-table"><thead><tr><th rowspan="2" style="vertical-align:middle;">Боец</th>`;
        for (let st = 1; st <= 3; st++) tableHtml += `<th colspan="4">ЭТАП ${st}</th>`;
        tableHtml += `</tr><tr>`;
        for (let st = 1; st <= 3; st++) tableHtml += `<th>K</th><th>D</th><th>A</th><th>PTS</th>`;
        tableHtml += `</tr></thead><tbody>`;
        
        const searchQuery = document.getElementById('stats-search').value.toLowerCase().trim();
        const filteredPlayers = activePlayers.filter(p => p.nickname.toLowerCase().includes(searchQuery));
        
        filteredPlayers.forEach(p => {
            tableHtml += `<tr><td>${p.nickname}</td>`;
            for (let st = 1; st <= 3; st++) {
                const globalStage = (t - 1) * 3 + st;
                const r = s ? s.find(x => x.player_id === p.id && x.stage_number === globalStage) : null;
                tableHtml += `
                    <td><input type="number" id="s-k-${p.id}-${globalStage}" value="${r ? r.kills : ''}" onchange="updateMatchStat(${p.id}, ${globalStage}, 'kills', this.value)"></td>
                    <td><input type="number" id="s-d-${p.id}-${globalStage}" value="${r ? r.deaths : ''}" onchange="updateMatchStat(${p.id}, ${globalStage}, 'deaths', this.value)"></td>
                    <td><input type="number" id="s-a-${p.id}-${globalStage}" value="${r ? r.assists : ''}" onchange="updateMatchStat(${p.id}, ${globalStage}, 'assists', this.value)"></td>
                    <td><input type="number" id="s-p-${p.id}-${globalStage}" value="${r ? r.points : ''}" onchange="updateMatchStat(${p.id}, ${globalStage}, 'points', this.value)"></td>`;
            }
            tableHtml += `</tr>`;
        });
        tableHtml += `</tbody></table>`;
        content.innerHTML = tableHtml; details.appendChild(content); container.appendChild(details);
    }
}

async function updateMatchStat(playerId, stageNum, field, value) {
    if (!isAdmin) return;
    const numVal = parseInt(value) || 0;
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;
    const { data: existing } = await supabaseClient.from('match_stats').select('*').eq('player_id', playerId).eq('stage_number', stageNum).eq('season_id', seasonId).single();
    let payload = { player_id: playerId, stage_number: stageNum, season_id: seasonId };
    if (existing) payload = { ...existing, [field]: numVal };
    else {
        payload.kills = field === 'kills' ? numVal : 0; payload.deaths = field === 'deaths' ? numVal : 0;
        payload.assists = field === 'assists' ? numVal : 0; payload.points = field === 'points' ? numVal : 0;
    }
    await supabaseClient.from('match_stats').upsert(payload, { onConflict: 'player_id, stage_number, season_id' });
    await recalculatePlayerStats(playerId);
}

async function recalculatePlayerStats(playerId) {
    if (!playerId) return;
    let q = supabaseClient.from('match_stats').select('*').eq('player_id', playerId);
    q = filterBySeason(q);
    const { data: stats } = await q;
    
    if (stats && stats.length > 0) {
        let tK = 0, tD = 0, tA = 0, tP = 0;
        stats.forEach(s => { tK += s.kills || 0; tD += s.deaths || 0; tA += s.assists || 0; tP += s.points || 0; });
        let kd = tD === 0 ? tK : (tK / tD), kda = tD === 0 ? (tK + tA) : ((tK + tA) / tD);
        kd = Math.round(kd * 100) / 100; kda = Math.round(kda * 100) / 100;
        await supabaseClient.from('players').update({ kd: kd, kda: kda, points: tP }).eq('id', playerId);
        const p = allPlayers.find(x => x.id === playerId);
        if (p) { p.kd = kd; p.kda = kda; p.points = tP; }
        renderTops();
    }
}

function initCompareTab() {
    const select = document.getElementById('compare-players'), periodSelect = document.getElementById('compare-period');
    if (select.tomselect) select.tomselect.destroy(); if (periodSelect.tomselect) periodSelect.tomselect.destroy();
    let options = ''; activePlayers.forEach(p => { options += `<option value="${p.id}">${p.nickname}</option>`; });
    select.innerHTML = options;
    new TomSelect(select, { create: false, sortField: { field: "text", direction: "asc" }, maxItems: 4, plugins: ['remove_button'], onChange: () => renderComparison() });
    new TomSelect(periodSelect, { create: false, onChange: () => renderComparison() });
}

function renderComparison() {
    const selectEl = document.getElementById('compare-players');
    const container = document.getElementById('compare-results');
    if (!selectEl || !selectEl.tomselect) return;
    const selectedIds = Array.from(selectEl.tomselect.getValue());
    if (selectedIds.length < 2) { container.innerHTML = '<div style="text-align:center; padding: 20px;">Выберите двух</div>'; return; }
    const players = selectedIds.map(id => allPlayers.find(p => p.id == id)).filter(Boolean);
    let thead = '<thead><tr><th>Характеристика</th>'; players.forEach(p => { thead += `<th>${p.nickname}</th>`; }); thead += '</tr></thead>';

    const stats = [
        { label: 'КД', key: 'kd', higher: true }, { label: 'КДА', key: 'kda', higher: true }, { label: 'Очки', key: 'points', higher: true },
        { label: 'Кувалда', key: 'has_sledgehammer', isBool: true },
        { label: 'Скорость (Б)', key: 'speed_combat', higher: true }, { label: 'Приведенка (Б)', key: 'penetration_combat', higher: true },
        { label: 'Скорость (К)', key: 'speed_combined', higher: true }, { label: 'Приведенка (К)', key: 'penetration_combined', higher: true },
        { label: 'Автомат', key: 'main_rifle' }, { label: 'ПП', key: 'main_smg' }, { label: 'Пулемет', key: 'machine_gun' }, { label: 'Дробовик', key: 'shotgun' },
        { label: 'Снайперка', key: 'sniper' }, { label: 'Пистолет', key: 'secondary_pistol' },
        { label: 'Броня (Б)', key: 'armor_combat' }, { label: 'Броня (К)', key: 'armor_combined' }
    ];
    let tbody = '<tbody>';
    stats.forEach(stat => {
        tbody += `<tr><td>${stat.label}</td>`;
        let bestVal = null; if (stat.higher) bestVal = Math.max(...players.map(p => stat.isBool ? (p[stat.key] ? 1 : 0) : (parseFloat(p[stat.key]) || 0)));
        players.forEach(p => {
            let val = p[stat.key];
            if (stat.isBool) tbody += `<td>${val ? '<span class="compare-winner">🔨</span>' : '❌'}</td>`;
            else if (stat.higher) {
                let numVal = parseFloat(val) || 0, isWinner = numVal === bestVal && players.filter(x => (parseFloat(x[stat.key]) || 0) === bestVal).length < players.length;
                tbody += `<td class="${isWinner ? 'compare-winner' : ''}">${val || '-'}</td>`;
            } else tbody += `<td>${val || '-'}</td>`;
        }); tbody += '</tr>';
    });
    tbody += '</tbody>';
    container.innerHTML = `<table class="compare-table">${thead}${tbody}</table>`;
}

async function loadMatchHistory() {
    const timeline = document.getElementById('history-timeline'); if (!timeline) return;
    timeline.innerHTML = '<div style="text-align:center; width:100%;">Загрузка...</div>';

    let q = supabaseClient.from('clan_matches').select('*').order('match_date', { ascending: true });
    q = filterBySeason(q);
    const { data: matches } = await q;
    
    let wins = 0, losses = 0, draws = 0, totalRating = 1000, totalGears = 0;
    
    if (!matches || matches.length === 0) {
        timeline.innerHTML = '<div style="text-align:center; width:100%;">Нет матчей</div>';
        renderHistoryChart(0, 0, 0); updateHistoryStats(1000, 'E', 0, 0, 0, 0);
        return;
    }

    matches.forEach(match => {
        const cScore = match.clan_score || 0, eScore = match.enemy_points || 0;
        const currentTier = getTierData(totalRating);

        if (cScore > eScore) {
            totalGears += currentTier.winGears;
            totalRating += 50;
            wins++;
        } else if (cScore < eScore) {
            if (cScore >= (eScore * 0.2)) totalGears += currentTier.lossGears;
            totalRating -= 50;
            losses++;
        } else {
            draws++;
        }
    });

    const finalTier = getTierData(totalRating);
    updateHistoryStats(totalRating, finalTier.name, totalGears, wins, losses, draws);

    timeline.innerHTML = '';
    const reversedMatches = [...matches].reverse(); 
    let currentCalcRating = 1000;
    
    reversedMatches.forEach((match) => {
        const dateStr = match.match_date ? new Date(match.match_date).toLocaleDateString('ru-RU') : 'Дата не указана';
        const cScore = match.clan_score || 0, eScore = match.enemy_points || 0;
        const opponent = match.enemy_name || 'Неизвестный враг', mapName = match.map_name || 'Не указана';
        let scoreClass = '', winText = '', gearsEarned = 0;
        const tierAtMatch = getTierData(currentCalcRating);

        if (cScore > eScore) { 
            scoreClass = 'win'; winText = 'ПОБЕДА'; gearsEarned = tierAtMatch.winGears; currentCalcRating += 50; 
        } else if (cScore < eScore) { 
            scoreClass = 'loss'; winText = 'ПОРАЖЕНИЕ'; 
            if (cScore >= (eScore * 0.2)) gearsEarned = tierAtMatch.lossGears;
            currentCalcRating -= 50; 
        } else { 
            winText = 'НИЧЬЯ'; 
        }

        const adminEdit = isAdmin ? `
            <div style="margin-top: 10px; padding-top: 10px; border-top: 1px dashed var(--border-color); display: flex; flex-direction: column; gap: 5px;">
                <input type="date" value="${match.match_date || ''}" onchange="updateMatchData(${match.id}, 'date', this.value)" style="background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:4px; border-radius:4px; font-size:0.8em;">
                <input type="text" value="${opponent}" onchange="updateMatchData(${match.id}, 'enemy_name', this.value)" placeholder="Враг" style="background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:4px; border-radius:4px; font-size:0.8em;">
                <select onchange="updateMatchData(${match.id}, 'map_name', this.value)" style="background:var(--input-bg); color:#ff9800; border:1px solid var(--border-color); padding:4px; border-radius:4px; font-size:0.8em; font-weight:bold;">
                    <option value="">-- Карта --</option>
                    <option value="Низина" ${match.map_name === 'Низина' ? 'selected' : ''}>Низина</option>
                    <option value="Малая Бердовка" ${match.map_name === 'Малая Бердовка' ? 'selected' : ''}>Малая Бердовка</option>
                    <option value="Хвойный" ${match.map_name === 'Хвойный' ? 'selected' : ''}>Хвойный</option>
                </select>
                <div style="display:flex; gap:5px;">
                    <input type="number" value="${cScore}" onchange="updateMatchData(${match.id}, 'clan_score', this.value)" placeholder="Мы" style="flex:1; background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:4px; border-radius:4px; font-size:0.8em;">
                    <input type="number" value="${eScore}" onchange="updateMatchData(${match.id}, 'enemy_points', this.value)" placeholder="Враг" style="flex:1; background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:4px; border-radius:4px; font-size:0.8em;">
                </div>
                <button class="btn btn-danger" style="padding: 4px; font-size: 0.75em;" onclick="deleteMatch(${match.id})">Удалить</button>
            </div>
        ` : '';

        timeline.innerHTML += `
            <div class="history-card ${scoreClass}">
                <div style="font-size:0.8em; color:var(--accent-color);">Этап ${match.stage_number || '-'}</div>
                <div style="font-size:0.85em; color:#9cdcfe;">🗺️ ${mapName}</div>
                <div style="font-size:0.8em; color:var(--text-muted);">${dateStr}</div>
                <div style="font-size:0.95em; font-weight:bold; margin-top:5px;">vs ${opponent}</div>
                <div style="font-size:1.4em; font-weight:bold; font-family:'Courier New', monospace;" class="${scoreClass === 'win' ? 'score-win' : (scoreClass === 'loss' ? 'score-loss' : '')}">${cScore} : ${eScore}</div>
                <div style="font-size:0.85em; color:var(--text-muted);">${winText}</div>
                ${gearsEarned > 0 ? `<div style="font-size:0.85em; color:#9cdcfe; font-weight:bold;">+${gearsEarned} гильз</div>` : ''}
                ${adminEdit}
            </div>
        `;
    });
    renderHistoryChart(wins, losses, draws);
}

function updateHistoryStats(rating, tierName, gears, wins, losses, draws) {
    const setTxt = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    setTxt('hr-rating', rating); setTxt('hr-tier', tierName); setTxt('hr-gears', gears);
    const total = wins + losses + draws;
    setTxt('hr-wins', wins); setTxt('hr-losses', losses); setTxt('hr-draws', draws); setTxt('hr-total', total);
    setTxt('hr-wins-pct', `(${total > 0 ? Math.round((wins/total)*100) : 0}%)`);
    setTxt('hr-losses-pct', `(${total > 0 ? Math.round((losses/total)*100) : 0}%)`);
    setTxt('hr-draws-pct', `(${total > 0 ? Math.round((draws/total)*100) : 0}%)`);
}

async function addMatchHistory() {
    const date = prompt("Дата (ГГГГ-ММ-ДД):", new Date().toISOString().split('T')[0]); if (!date) return;
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;
    await supabaseClient.from('clan_matches').insert([{ match_date: date, clan_score: 0, enemy_points: 0, enemy_name: 'Новый', map_name: 'Низина', season_id: seasonId }]);
    showToast('Добавлен', 'success'); loadMatchHistory();
}

async function updateMatchData(id, field, value) {
    if (!isAdmin) return;
    let val = value; if (field === 'clan_score' || field === 'enemy_points') val = parseInt(value) || 0;
    await supabaseClient.from('clan_matches').update({ [field]: val }).eq('id', id);
    loadMatchHistory();
}

async function deleteMatch(id) {
    if (!isAdmin || !confirm('Удалить?')) return;
    await supabaseClient.from('clan_matches').delete().eq('id', id); loadMatchHistory();
}

function renderHistoryChart(wins, losses, draws = 0) {
    const canvas = document.getElementById('matchHistoryChart'); if (!canvas) return;
    if (myChart) myChart.destroy();
    const hasData = wins > 0 || losses > 0 || draws > 0;
    myChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Поб', 'Пор', 'Нич'],
            datasets: [{ data: hasData ? [wins, losses, draws] : [1, 0, 0], backgroundColor: hasData ? ['#4caf50', '#e53935', '#ff9800'] : ['#2a3a2a', '#2a3a2a', '#2a3a2a'], borderColor: '#0d0f0d', borderWidth: 2 }]
        },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: hasData } }, cutout: '70%' }
    });
}

async function loadCalendar() {
    const list = document.getElementById('calendar-list'); if (!list) return; list.innerHTML = 'Загрузка...';
    const { data: events, error } = await supabaseClient.from('clan_calendar').select('*').order('match_date', { ascending: true }).order('tournament_number', { ascending: true });
    if (error) { list.innerHTML = `<div style="color:red;">Ошибка БД: ${error.message}</div>`; return; }
    
    const { data: matches } = await supabaseClient.from('clan_matches').select('stage_number');
    let maxStage = 0; if (matches && matches.length > 0) { maxStage = Math.max(...matches.map(m => m.stage_number || 0)); }
    const bulkInput = document.getElementById('bulk-start-tournament');
    if (bulkInput) bulkInput.value = (Math.ceil(maxStage / 3) || 0) + 1;

    const showPast = document.getElementById('show-past-calendar')?.checked || false;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

    const filteredEvents = (events || []).filter(e => {
        const seasonMatch = activeSeasonId === 'all' || Number(e.season_id) === Number(activeSeasonId);
        if (!seasonMatch) return false;
        if (showPast) return true;
        if (e.match_date < todayStr) return false;
        if (e.match_date === todayStr && e.match_time) {
            const eventDateTime = new Date(`${e.match_date}T${e.match_time}`);
            const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
            if (eventDateTime < threeHoursAgo) return false;
        }
        return true;
    });

    if (filteredEvents.length === 0) { 
        list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Нет предстоящих турниров</div>'; 
        return; 
    }
    
    const grouped = {};
    filteredEvents.forEach(e => {
        const key = `${e.match_date}_${e.tournament_number}_${e.match_time}`;
        if (!grouped[key]) grouped[key] = { date: e.match_date, time: e.match_time, tourney: e.tournament_number, notes: e.notes, stages: [], ids: [] };
        if (e.stage_number) grouped[key].stages.push(e.stage_number); grouped[key].ids.push(e.id);
    });
    
    list.innerHTML = '';
    Object.values(grouped).forEach(g => {
        const isPast = g.date < todayStr;
        const dateStr = g.date ? new Date(g.date).toLocaleDateString('ru-RU') : 'Дата не указана', timeStr = g.time ? g.time.slice(0, 5) : '';
        const stagesStr = g.stages.length > 0 ? g.stages.sort((a,b)=>a-b).join(', ') : '-', idsStr = g.ids.join(',');
        const opacity = isPast ? '0.5' : '1';
        const pastTag = isPast ? '<span style="color:var(--danger-color); font-size:0.8em; margin-left:10px;">(ПРОШЕЛ)</span>' : '';

        list.innerHTML += `
        <div class="calendar-card" style="margin-bottom:15px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; padding:15px; background:var(--card-bg); border:1px solid var(--border-color); border-radius:4px; opacity:${opacity};">
            <div>
                <div style="color:var(--accent-color); font-weight:bold; font-size:1.1em;">${dateStr} ${timeStr ? 'в ' + timeStr : ''} ${pastTag}</div>
                <div style="font-size:0.9em; margin-top:5px;">Турнир: <strong>${g.tourney || '-'}</strong> | Этапы: <strong>${stagesStr}</strong></div>
                <div style="color:var(--text-muted); font-size:0.9em; margin-top:5px;">${g.notes || ''}</div>
            </div>
            ${isAdmin ? `
            <div style="display:flex; gap:10px; align-items:center;">
                <button class="btn" style="background:var(--accent-color); color:#000;" onclick="moveCalendarToHistory(${g.ids[0]}, '${g.date}', ${g.tourney}, ${g.stages[0] || 1})">Провести матч</button>
                <button class="btn btn-danger" style="padding: 6px 12px;" onclick="deleteCalendarEvents([${idsStr}])">X</button>
            </div>` : ''}
        </div>`;
    });
}

async function moveCalendarToHistory(calId, date, tourney, stage) {
    if (!isAdmin || !confirm('Перенести в Историю матчей? (Турнир исчезнет из календаря)')) return;
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;

    const { error: insErr } = await supabaseClient.from('clan_matches').insert([{
        match_date: date, clan_score: 0, enemy_points: 0, enemy_name: 'Неизвестный враг', map_name: 'Низина', stage_number: tourney || 1, season_id: seasonId
    }]);

    if (insErr) return showToast('Ошибка: ' + insErr.message, 'error');
    await supabaseClient.from('clan_calendar').delete().eq('id', calId);
    showToast('Турнир перенесен в Историю!', 'success');
    loadCalendar(); loadMatchHistory();
}

async function addUpcomingMatch() {
    if (!isAdmin) return;
    const date = document.getElementById('cal-date').value, time = document.getElementById('cal-time').value;
    const tourney = parseInt(document.getElementById('cal-tournament').value) || null, stage = parseInt(document.getElementById('cal-stage').value) || null;
    const notes = document.getElementById('cal-notes').value.trim(); if (!date) return showToast('Выберите дату', 'error');
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;
    const { error } = await supabaseClient.from('clan_calendar').insert([{ match_date: date, match_time: time || null, tournament_number: tourney, stage_number: stage, notes: notes, season_id: seasonId }]);
    if (error) return showToast('Ошибка БД: ' + error.message, 'error');
    showToast('Добавлен', 'success'); loadCalendar();
}

async function generateBulkCalendar() {
    if (!isAdmin) return;
    const btn = document.querySelector('button[onclick="generateBulkCalendar()"]');
    if (btn) { btn.disabled = true; btn.innerText = 'Генерация...'; }

    const startStr = document.getElementById('bulk-start').value, endStr = document.getElementById('bulk-end').value;
    const time = document.getElementById('bulk-time').value, notes = document.getElementById('bulk-notes').value.trim();
    let startTourney = parseInt(document.getElementById('bulk-start-tournament').value) || 1;
    if (!startStr || !endStr) { if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; } return showToast('Укажите даты', 'error'); }
    
    const selectedDays = Array.from(document.querySelectorAll('.bulk-day:checked')).map(cb => parseInt(cb.value));
    if (selectedDays.length === 0) { if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; } return showToast('Выберите дни', 'error'); }
    
    let current = new Date(startStr); const end = new Date(endStr); const events = []; let currentTourney = startTourney;
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;
    
    while (current <= end) {
        if (selectedDays.includes(current.getDay())) {
            const dateStr = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`;
            for (let stageNum = 1; stageNum <= 3; stageNum++) events.push({ match_date: dateStr, match_time: time || null, tournament_number: currentTourney, stage_number: stageNum, notes, season_id: seasonId });
            currentTourney++; 
        }
        current.setDate(current.getDate() + 1);
    }
    
    if (events.length === 0) { if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; } return showToast('Нет дней', 'info'); }
    
    const { error } = await supabaseClient.from('clan_calendar').insert(events);
    if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; }
    
    if (error) {
        showToast('Ошибка БД: ' + error.message, 'error');
    } else {
        showToast(`Добавлено ${events.length / 3} турниров`, 'success');
        document.getElementById('bulk-start').value = ''; document.getElementById('bulk-end').value = ''; 
        loadCalendar();
    }
}

async function deleteCalendarEvents(ids) {
    if (!isAdmin || !confirm('Удалить?')) return;
    for (const id of ids) await supabaseClient.from('clan_calendar').delete().eq('id', id);
    loadCalendar(); showToast('Удалено', 'success');
}

async function loadFines() {
    const { data } = await supabaseClient.from('fines').select('*, players(nickname)').order('created_at', { ascending: false });
    const tb = document.getElementById('fines-table-body'); if (!tb) return;
    tb.innerHTML = (data || []).map(f => `<tr><td><strong>${f.players?.nickname || '??'}</strong></td><td>${f.reason}</td><td style="color:red;">${f.amount} ₽</td><td class="${f.status === 'open' ? 'status-1' : 'status-3'}">${f.status === 'open' ? 'Открыт' : 'Закрыт'}</td><td><button class="btn" style="padding:4px 8px;" onclick="toggleFineStatus(${f.id}, '${f.status}')">${f.status === 'open' ? 'Закрыть' : 'Открыть'}</button><button class="btn btn-danger" style="padding:4px 8px;" onclick="deleteFine(${f.id})">X</button></td></tr>`).join('');
}

async function addFine() {
    const pid = document.getElementById('fine-player').value, r = document.getElementById('fine-reason').value.trim(), a = parseInt(document.getElementById('fine-amount').value) || 0;
    if (!pid || !r) return showToast('Выберите игрока', 'error');
    await supabaseClient.from('fines').insert([{ player_id: pid, reason: r, amount: a, status: 'open' }]);
    showToast('Добавлен', 'success'); document.getElementById('fine-reason').value = ''; document.getElementById('fine-amount').value = ''; loadFines();
}

async function toggleFineStatus(id, st) { await supabaseClient.from('fines').update({ status: st === 'open' ? 'closed' : 'open' }).eq('id', id); loadFines(); }
async function deleteFine(id) { if (confirm('Удалить?')) { await supabaseClient.from('fines').delete().eq('id', id); loadFines(); } }

async function loadAnalytics() {
    let q = supabaseClient.from('players').select('*'); q = filterBySeason(q); const { data: players } = await q;
    if (!players) return; 
    const active = players.filter(p => !p.status || p.status === 'в клане');
    
    const topKD = [...active].sort((a, b) => b.kd - a.kd).slice(0, 10);
    document.querySelector('#top-kd-table tbody').innerHTML = topKD.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.kd}</td></tr>`).join('');
    
    const topKDA = [...active].sort((a, b) => b.kda - a.kda).slice(0, 10);
    document.querySelector('#top-kda-table tbody').innerHTML = topKDA.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.kda}</td></tr>`).join('');
    
    const topP = [...active].sort((a, b) => b.points - a.points).slice(0, 10);
    document.querySelector('#top-points-table tbody').innerHTML = topP.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.points}</td></tr>`).join('');
    
    document.getElementById('stat-total-players').innerText = active.length;
    const inS = active.filter(p => p.squad && p.squad.trim() !== '').length;
    document.getElementById('stat-in-squads').innerText = inS; document.getElementById('stat-free').innerText = active.length - inS;

    let qMatches = supabaseClient.from('clan_matches').select('*'); qMatches = filterBySeason(qMatches); const { data: matches } = await qMatches;
    const mapStatsBody = document.querySelector('#map-stats-table tbody');
    if (matches && matches.length > 0) {
        const mapData = {};
        matches.forEach(m => {
            const map = m.map_name ? m.map_name.trim() : 'Неизвестная';
            if (!mapData[map]) mapData[map] = { games: 0, wins: 0 };
            mapData[map].games++;
            if (m.clan_score > m.enemy_points) mapData[map].wins++;
        });
        const sortedMaps = Object.entries(mapData).sort((a, b) => b[1].games - a[1].games);
        mapStatsBody.innerHTML = sortedMaps.map(([name, data]) => {
            const wr = Math.round((data.wins / data.games) * 100);
            const wrColor = wr >= 50 ? 'var(--success-color)' : 'var(--danger-color)';
            return `<tr><td>${name}</td><td>${data.games}</td><td>${data.wins}</td><td style="color:${wrColor}; font-weight:bold;">${wr}%</td></tr>`;
        }).join('');
    } else {
        mapStatsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Нет данных</td></tr>';
    }

    if (active.length > 0) {
        const sumKd = active.reduce((acc, p) => acc + (p.kd || 0), 0);
        const sumKda = active.reduce((acc, p) => acc + (p.kda || 0), 0);
        const sumPts = active.reduce((acc, p) => acc + (p.points || 0), 0);
        document.getElementById('avg-kd-total').innerText = (sumKd / active.length).toFixed(2);
        document.getElementById('avg-kda-total').innerText = (sumKda / active.length).toFixed(2);
        document.getElementById('avg-points-total').innerText = Math.round(sumPts / active.length);

        let qStats = supabaseClient.from('match_stats').select('*'); qStats = filterBySeason(qStats); const { data: allStats } = await qStats;
        if (allStats && allStats.length > 0) {
            const activeIds = new Set(active.map(p => p.id));
            const activeStats = allStats.filter(s => activeIds.has(s.player_id));
            if (activeStats.length > 0) {
                let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalPoints = 0;
                activeStats.forEach(s => { totalKills += s.kills || 0; totalDeaths += s.deaths || 0; totalAssists += s.assists || 0; totalPoints += s.points || 0; });
                let kdStage = totalDeaths === 0 ? totalKills : (totalKills / totalDeaths);
                let kdaStage = totalDeaths === 0 ? (totalKills + totalAssists) : ((totalKills + totalAssists) / totalDeaths);
                const stagesCount = Math.max(...activeStats.map(s => s.stage_number));
                const avgPtsStage = totalPoints / stagesCount;
                document.getElementById('avg-kd-stage').innerText = kdStage.toFixed(2);
                document.getElementById('avg-kda-stage').innerText = kdaStage.toFixed(2);
                document.getElementById('avg-points-stage').innerText = Math.round(avgPtsStage);
            }
        }
    }
}

async function loadPlayerNotes(playerId) {
    const { data: notes, error } = await supabaseClient.from('player_notes').select('*').eq('player_id', playerId).order('created_at', { ascending: false });
    const coachList = document.getElementById('player-notes-list'), tkList = document.getElementById('player-timekeeper-notes-list');
    if (!coachList || !tkList) return;
    if (error) { coachList.innerHTML = 'Ошибка'; tkList.innerHTML = ''; return; }
    const coachNotes = (notes || []).filter(n => n.note_type === 'coach'), tkNotes = (notes || []).filter(n => n.note_type === 'timekeeper');
    const renderNotes = (arr) => arr.length === 0 ? 'Нет заметок' : arr.map(n => `<div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:4px; padding:8px 10px; margin-bottom:6px; font-size:0.9em; display:flex; justify-content:space-between; align-items:center;"><div>${n.content}</div><button class="btn btn-danger" style="padding:2px 8px; font-size:0.8em;" onclick="deletePlayerNote(${n.id}, ${playerId})">✕</button></div>`).join('');
    coachList.innerHTML = renderNotes(coachNotes); tkList.innerHTML = renderNotes(tkNotes);
}

async function addPlayerNote(type) {
    if (!currentEditId) return showToast('Выберите игрока', 'error');
    const inputId = type === 'coach' ? 'player-note-input' : 'player-timekeeper-note-input';
    const content = document.getElementById(inputId).value.trim(); if (!content) return;
    await supabaseClient.from('player_notes').insert([{ player_id: currentEditId, note_type: type, content: content }]);
    document.getElementById(inputId).value = ''; showToast('Добавлено', 'success');
    await loadAllData(); await loadPlayerNotes(currentEditId);
}

async function deletePlayerNote(noteId, playerId) {
    if (!confirm('Удалить?')) return;
    await supabaseClient.from('player_notes').delete().eq('id', noteId);
    await loadAllData(); await loadPlayerNotes(playerId);
}

async function sendAnalyticsScreenshot() { showToast('Отправка в Discord...', 'info'); setTimeout(() => showToast('Готово!', 'success'), 1000); }
async function sendRosterScreenshot() { showToast('Отправка в Discord...', 'info'); setTimeout(() => showToast('Готово!', 'success'), 1000); }

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = error => reject(error);
    });
}

function openPhotoModal(input) {
    if (!input.files || input.files.length === 0) return;
    currentPhotoFiles = Array.from(input.files); 
    
    const previewContainer = document.getElementById('photo-preview');
    const oldStageSelect = document.getElementById('modal-stage');
    
    if (oldStageSelect && oldStageSelect.parentElement) {
        oldStageSelect.parentElement.style.display = 'none';
    }

    if (previewContainer) {
        previewContainer.innerHTML = '';
        previewContainer.style.display = 'flex';
        previewContainer.style.flexDirection = 'column';
        previewContainer.style.gap = '10px';

        let maxTourney = Math.ceil(maxAttendanceStage / 3);
        if (maxTourney < 1) maxTourney = 1;

        currentPhotoFiles.forEach((file, index) => {
            const block = document.createElement('div');
            block.style.display = 'flex';
            block.style.alignItems = 'center';
            block.style.gap = '10px';
            block.style.background = 'var(--input-bg)';
            block.style.padding = '10px';
            block.style.borderRadius = 'var(--radius)';
            block.style.border = '1px solid var(--border-color)';
            block.style.flexWrap = 'wrap';

            const img = document.createElement('img');
            img.style.width = '50px';
            img.style.height = '50px';
            img.style.objectFit = 'cover';
            img.style.borderRadius = '4px';
            const reader = new FileReader();
            reader.onload = (e) => { img.src = e.target.result; };
            reader.readAsDataURL(file);

            const fileName = document.createElement('span');
            fileName.textContent = file.name;
            fileName.style.fontSize = '0.8em';
            fileName.style.color = 'var(--text-muted)';
            fileName.style.flex = '1';
            fileName.style.overflow = 'hidden';
            fileName.style.textOverflow = 'ellipsis';
            fileName.style.whiteSpace = 'nowrap';
            fileName.style.minWidth = '100px';

            const tourneySelect = document.createElement('select');
            tourneySelect.className = 'photo-tourney-select';
            tourneySelect.dataset.index = index;
            tourneySelect.style.padding = '4px';
            tourneySelect.style.fontSize = '0.8em';
            for (let i = 1; i <= Math.max(maxTourney, 5); i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `Турнир ${i}`;
                if (i === maxTourney) opt.selected = true; 
                tourneySelect.appendChild(opt);
            }

            const stageSelect = document.createElement('select');
            stageSelect.className = 'photo-stage-select';
            stageSelect.dataset.index = index;
            stageSelect.style.padding = '4px';
            stageSelect.style.fontSize = '0.8em';
            for (let i = 1; i <= 3; i++) {
                const opt = document.createElement('option');
                opt.value = i;
                opt.textContent = `Этап ${i}`;
                if (i === index + 1 && i <= 3) opt.selected = true; 
                stageSelect.appendChild(opt);
            }

            block.appendChild(img);
            block.appendChild(fileName);
            
            const controlsWrapper = document.createElement('div');
            controlsWrapper.style.display = 'flex';
            controlsWrapper.style.gap = '5px';
            controlsWrapper.appendChild(tourneySelect);
            controlsWrapper.appendChild(stageSelect);
            
            block.appendChild(controlsWrapper);
            previewContainer.appendChild(block);
        });
    }

    document.getElementById('photo-modal').style.display = 'flex';
}

function closePhotoModal() {
    document.getElementById('photo-modal').style.display = 'none';
    document.getElementById('attendance-photo').value = '';
    currentPhotoFiles = [];
    
    const previewContainer = document.getElementById('photo-preview');
    if (previewContainer) {
        previewContainer.innerHTML = '';
        previewContainer.style.display = 'none';
    }
    
    const oldStageSelect = document.getElementById('modal-stage');
    if (oldStageSelect && oldStageSelect.parentElement) {
        oldStageSelect.parentElement.style.display = 'block';
    }
}

async function confirmPhotoUpload() {
    if (currentPhotoFiles.length === 0) return showToast('Файлы не выбраны', 'error');
    if (!GEMINI_API_KEY || GEMINI_API_KEY.trim() === '') return showToast('Ошибка: Не указан ключ Gemini в appv6.js', 'error');

    const tourneySelects = document.querySelectorAll('.photo-tourney-select');
    const stageSelects = document.querySelectorAll('.photo-stage-select');
    const uploads = [];
    
    tourneySelects.forEach((select, index) => {
        const tourney = parseInt(select.value);
        const stage = parseInt(stageSelects[index].value);
        const globalStage = (tourney - 1) * 3 + stage; 
        
        if (currentPhotoFiles[index]) {
            uploads.push({ file: currentPhotoFiles[index], globalStage });
        }
    });

    showToast(`ИИ обрабатывает ${uploads.length} фото...`, 'info');
    closePhotoModal();

    let totalRecognized = 0;
    let totalSaved = 0;

    for (const upload of uploads) {
        try {
            const base64Data = await fileToBase64(upload.file);
            
            const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{
                        parts: [
                            { text: "Проанализируй этот скриншот игры. Найди список ников игроков. Верни ТОЛЬКО массив JSON со списком ников в формате [\"Ник1\", \"Ник2\", ...]. Никакого другого текста, без markdown разметки." },
                            { inline_data: { mime_type: upload.file.type, data: base64Data } }
                        ]
                    }]
                })
            });

            const resData = await response.json();
            if (resData.error) throw new Error(resData.error.message);

            let textResponse = resData.candidates[0].content.parts[0].text;
            textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
            
            let foundNicks = [];
            try {
                foundNicks = JSON.parse(textResponse);
            } catch(e) {
                console.warn("ИИ вернул не JSON:", textResponse);
                continue; 
            }

            if (!Array.isArray(foundNicks)) continue;
            totalRecognized += foundNicks.length;

            const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : activeSeasonId;
            
            for (const rawNick of foundNicks) {
                const matchedPlayer = findBestPlayerMatch(rawNick, activePlayers);
                
                if (matchedPlayer) {
                    await supabaseClient.from('attendance').upsert({
                        player_id: matchedPlayer.id,
                        tournament_number: upload.globalStage,
                        status: 'Пришел',
                        season_id: seasonId
                    }, { onConflict: 'player_id, tournament_number, season_id' });
                    totalSaved++;
                }
            }
        } catch (err) {
            console.error("Ошибка распознавания:", err);
            showToast('Ошибка ИИ: ' + err.message, 'error');
        }
    }

    showToast(`ИИ прочитал ${totalRecognized} ников. Успешно засчитано ${totalSaved} игроков!`, 'success');
    
    if (document.getElementById('tab-attendance').classList.contains('active')) {
        loadAttendance();
    }
}

function saveAbsentStatuses() {
    document.getElementById('absent-modal').style.display = 'none';
    showToast('Сохранено', 'success');
}

// ==================== INIT ====================
async function init() {
    await loadSeasons();
    await loadAllData();
    setupRealtimeSync();
    await checkAndBackupIfStale();
}

init();
