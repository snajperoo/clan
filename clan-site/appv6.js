const SUPABASE_URL = 'https://rpqiapddvlkdecddczqx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hDt4D6V24JeooGxNoLN4rQ__YFppVSz'; 
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================== ЕДИНЫЙ STATE ====================
const AppState = {
    players: [], activePlayers: [],
    attendance: [], matchStats: [], matches: [], fines: [],
    tournaments: [], seasons: [],
    upcomingMatches: [],
    activeSeason: null, viewingSeason: null,
};

let currentEditId = null, isAdmin = false;
let currentPhotoFiles = []; // <--- Массив для файлов
let pendingAbsentPlayers = [], currentAbsentStage = null;
let currentSortColumn = 'kd', currentSortDirection = 'desc';
let topsSeasonMode = 'all'; 
let myChart = null, compareChart = null;

const ADMIN_SECRET_CODE = 'ADMIN123';
const STATUS_PRIORITY = { 'в обработке': 1, 'в клане': 2, 'кикнут': 3 };
const TOURNAMENTS_PER_SEASON = 12;
const STAGES_PER_TOURNAMENT = 3;
const RATING_CHANGE = 50;
const START_RATING = 1000;

const SQUADS_CONFIG = [
    { name: '1 Штурмовой отряд', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '2 Штурмовой отряд', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '3 Штурмовой отряд', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '4 Отряд поддержки', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '5 Отряд поддержки', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] },
    { name: '6 Отряд ралики', roles: ['Командир отряда', 'Зам. командира отряда', 'Боец 1', 'Боец 2', 'Боец 3', 'Запас'] }
];

function getLocalDateString(date = new Date()) {
    const offset = date.getTimezoneOffset();
    const localDate = new Date(date.getTime() - (offset * 60 * 1000));
    return localDate.toISOString().split('T')[0];
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

function isViewingActive() {
    return AppState.viewingSeason && AppState.viewingSeason.is_active;
}
function canEdit() {
    return isAdmin && isViewingActive();
}

// ==================== ЗАГРУЗКА СЕЗОНОВ ====================
async function loadSeasons() {
    const { data } = await supabaseClient.from('seasons').select('*').order('season_number');
    AppState.seasons = data || [];
    AppState.activeSeason = AppState.seasons.find(s => s.is_active) || AppState.seasons[AppState.seasons.length - 1] || null;
    if (!AppState.viewingSeason) {
        AppState.viewingSeason = AppState.activeSeason;
    } else {
        AppState.viewingSeason = AppState.seasons.find(s => s.id === AppState.viewingSeason.id) || AppState.activeSeason;
    }
    renderSeasonSelector();
    updateArchiveBanner();
}

function renderSeasonSelector() {
    const sel = document.getElementById('season-selector');
    if (!sel) return;
    sel.innerHTML = '';
    AppState.seasons.forEach(s => {
        const o = document.createElement('option');
        o.value = s.id;
        o.textContent = `Сезон ${s.season_number}${s.is_active ? ' (активный)' : ''}`;
        if (AppState.viewingSeason && s.id === AppState.viewingSeason.id) o.selected = true;
        sel.appendChild(o);
    });
    const progressEl = document.getElementById('season-progress');
    if (progressEl && AppState.viewingSeason) {
        const tCount = AppState.tournaments.length;
        const stages = getMaxStage();
        progressEl.innerText = `${tCount}/${TOURNAMENTS_PER_SEASON} · ${stages}/${TOURNAMENTS_PER_SEASON * STAGES_PER_TOURNAMENT} этапов`;
    }
}

function updateArchiveBanner() {
    const banner = document.getElementById('archive-banner');
    if (!banner) return;
    if (AppState.viewingSeason && !AppState.viewingSeason.is_active) {
        banner.style.display = 'flex';
        banner.innerHTML = `📦 Вы смотрите архивный <strong>Сезон ${AppState.viewingSeason.season_number}</strong>. Редактирование отключено.`;
    } else {
        banner.style.display = 'none';
    }
}

function switchViewingSeason(seasonId) {
    const s = AppState.seasons.find(x => x.id === parseInt(seasonId));
    if (!s) return;
    AppState.viewingSeason = s;
    updateArchiveBanner();
    renderSeasonSelector();
    refreshAll();
}

// ==================== НОВЫЙ СЕЗОН ====================
async function startNewSeason() {
    if (!isAdmin) { showToast('Только для админа', 'error'); return; }

    const lastNum = AppState.seasons.length > 0 ? Math.max(...AppState.seasons.map(s => s.season_number)) : 0;
    const nextNum = lastNum + 1;
    const currentTournaments = AppState.tournaments.length;

    let msg = `Начать Сезон ${nextNum}? Текущий сезон будет закрыт (архив).`;
    if (currentTournaments < TOURNAMENTS_PER_SEASON && AppState.activeSeason) {
        msg = `⚠️ В текущем сезоне только ${currentTournaments}/${TOURNAMENTS_PER_SEASON} турниров.\n\n${msg}`;
    }
    if (!confirm(msg)) return;

    if (AppState.activeSeason) {
        await supabaseClient.from('seasons').update({ is_active: false, ended_at: new Date().toISOString() }).eq('id', AppState.activeSeason.id);
    }

    const { data, error } = await supabaseClient.from('seasons').insert([{
        season_number: nextNum, name: `Сезон ${nextNum}`, is_active: true
    }]).select().single();
    if (error) { showToast('Ошибка: ' + error.message, 'error'); return; }

    await supabaseClient.from('tournaments').insert([{ tournament_number: 1, season_id: data.id }]);

    await loadSeasons();
    AppState.viewingSeason = AppState.activeSeason;
    await refreshAll();
    showToast(`Сезон ${nextNum} начат!`, 'success');
}

// ==================== REFRESH ====================
async function refreshTournaments() {
    if (!AppState.viewingSeason) { AppState.tournaments = []; return; }
    const { data } = await supabaseClient.from('tournaments').select('*').eq('season_id', AppState.viewingSeason.id).order('tournament_number');
    AppState.tournaments = data || [];
}

async function refreshPlayers() {
    const { data } = await supabaseClient.from('players').select('*').order('kd', { ascending: false });
    AppState.players = data || [];
    AppState.activePlayers = AppState.players.filter(p => !p.status || p.status === 'в клане');
}

async function refreshAttendance() {
    if (!AppState.viewingSeason) { AppState.attendance = []; return; }
    const { data } = await supabaseClient.from('attendance').select('*').eq('season_id', AppState.viewingSeason.id);
    AppState.attendance = data || [];
}

async function refreshMatchStats() {
    if (!AppState.viewingSeason) { AppState.matchStats = []; return; }
    const { data } = await supabaseClient.from('match_stats').select('*').eq('season_id', AppState.viewingSeason.id);
    AppState.matchStats = data || [];
}

async function refreshMatches() {
    if (!AppState.viewingSeason) { AppState.matches = []; return; }
    const { data } = await supabaseClient.from('clan_matches').select('*').eq('season_id', AppState.viewingSeason.id);
    AppState.matches = data || [];
}

async function refreshFines() {
    const { data } = await supabaseClient.from('fines').select('*').order('created_at', { ascending: false });
    AppState.fines = data || [];
}

async function refreshUpcoming() {
    if (!AppState.viewingSeason) { AppState.upcomingMatches = []; return; }
    const { data } = await supabaseClient.from('upcoming_matches').select('*').eq('season_id', AppState.viewingSeason.id).order('match_date');
    AppState.upcomingMatches = data || [];
}

function getMaxStage() {
    let max = 0;
    AppState.tournaments.forEach(t => { if (t.tournament_number * STAGES_PER_TOURNAMENT > max) max = t.tournament_number * STAGES_PER_TOURNAMENT; });
    AppState.attendance.forEach(a => { if (a.tournament_number > max) max = a.tournament_number; });
    AppState.matchStats.forEach(s => { if (s.stage_number > max) max = s.stage_number; });
    AppState.matches.forEach(m => { if (m.stage_number && m.stage_number > max) max = m.stage_number; });
    
    const today = getLocalDateString();
    AppState.upcomingMatches.forEach(u => {
        if (u.stage_number && u.match_date <= today && u.stage_number > max) {
            max = u.stage_number;
        }
    });
    
    return Math.max(3, max);
}

async function refreshAll() {
    await loadSeasons();
    await Promise.all([refreshPlayers(), refreshTournaments()]);
    await Promise.all([refreshAttendance(), refreshMatchStats(), refreshMatches(), refreshFines(), refreshUpcoming()]);
    renderTops();
    renderPlayerList();
    fillPlayerSelects();
    renderSeasonSelector();
    populateProfileDropdowns();
    
    const active = document.querySelector('.tab-content.active');
    if (active) {
        const id = active.id;
        if (id === 'tab-attendance') loadAttendance();
        else if (id === 'tab-stats') loadMatchStats();
        else if (id === 'tab-history') loadMatchHistory();
        else if (id === 'tab-fines') loadFines();
        else if (id === 'tab-missed') loadAllMissed();
        else if (id === 'tab-analytics') loadAnalytics();
        else if (id === 'tab-calendar') loadCalendar();
        else if (id === 'tab-compare') initCompareTab();
        else if (id === 'tab-roster') initDragAndDrop();
    }
}

// ==================== АВТОРИЗАЦИЯ ====================
function checkLogin() {
    const input = document.getElementById('login-input').value.trim(); if (!input) return;
    if (input === ADMIN_SECRET_CODE) {
        isAdmin = true; document.body.classList.add('is-admin');
        document.getElementById('login-modal').style.display = 'none';
        document.getElementById('logout-btn').style.display = 'inline-block';
        document.getElementById('my-profile-tab').style.display = 'inline-block';
        refreshAll();
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex'); 
        showToast('Вы вошли как Администратор', 'info');
    } else {
        const player = AppState.players.find(p => p.discord_id && p.discord_id.toString().trim() === input);
        if (player) {
            document.getElementById('login-modal').style.display = 'none';
            document.getElementById('logout-btn').style.display = 'inline-block';
            document.getElementById('my-profile-tab').style.display = 'inline-block';
            refreshAll().then(() => loadMyProfile(player));
            showToast('Успешный вход', 'success');
        } else { document.getElementById('login-error').innerText = 'Игрок с таким Discord ID не найден.'; }
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
    if (tabName === 'tab-fines') loadFines();
    if (tabName === 'tab-attendance') loadAttendance();
    if (tabName === 'tab-missed') loadAllMissed();
    if (tabName === 'tab-stats') loadMatchStats();
    if (tabName === 'tab-analytics') loadAnalytics();
    if (tabName === 'tab-calendar') loadCalendar();
}

function goToPlayerProfile(playerId) {
    if (!isAdmin) { showToast('Доступно только администраторам', 'error'); return; }
    const profileTabBtn = document.querySelector('.tab-btn[onclick*="tab-profile"]');
    if (profileTabBtn) profileTabBtn.click();
    const player = AppState.players.find(p => p.id === playerId);
    if (player) setTimeout(() => { selectPlayer(player); }, 50);
}

// ==================== ТОПЫ ====================
function computeSeasonStats(playerId, seasonId) {
    const stats = AppState.matchStats.filter(s => s.player_id === playerId);
    let k = 0, d = 0, a = 0, p = 0;
    stats.forEach(s => { k += s.kills || 0; d += s.deaths || 0; a += s.assists || 0; p += s.points || 0; });
    const kd = d === 0 ? k : k / d;
    const kda = d === 0 ? (k + a) : (k + a) / d;
    return { kd: Math.round(kd * 100) / 100, kda: Math.round(kda * 100) / 100, points: p, games: stats.length };
}

function getTopsData() {
    if (topsSeasonMode === 'season') {
        return AppState.activePlayers.map(p => {
            const st = computeSeasonStats(p.id);
            return { ...p, kd: st.kd, kda: st.kda, points: st.points };
        });
    }
    return AppState.activePlayers;
}

function setTopsMode(mode) {
    topsSeasonMode = mode;
    renderTops();
}

function renderTops() {
    document.getElementById('loading-tops').style.display = 'none'; 
    document.getElementById('table-tops').style.display = 'block';
    const tbody = document.getElementById('players-table-body');
    const columns = ['nickname', 'discord_id', 'kd', 'kda', 'points'];
    columns.forEach(col => {
        const icon = document.getElementById(`sort-icon-${col}`);
        if (icon) {
            if (col === currentSortColumn) { icon.innerText = currentSortDirection === 'asc' ? ' ▲' : ' ▼'; icon.style.color = 'var(--accent-color)'; } 
            else { icon.innerText = ''; }
        }
    });

    const data = getTopsData();
    let sorted = [...data].sort((a, b) => {
        let valA = a[currentSortColumn], valB = b[currentSortColumn];
        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';
        if (typeof valA === 'string' && typeof valB === 'string') { return currentSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA); } 
        else { return currentSortDirection === 'asc' ? (parseFloat(valA) || 0) - (parseFloat(valB) || 0) : (parseFloat(valB) || 0) - (parseFloat(valA) || 0); }
    });

    tbody.innerHTML = sorted.length === 0 ? '<tr><td colspan="6" style="text-align:center;">Нет данных</td></tr>' : '';
    sorted.forEach((p, i) => {
        tbody.innerHTML += `<tr><td>#${i+1}</td><td><strong>${p.nickname}</strong></td><td>${p.discord_id || '-'}</td><td>${p.kd}</td><td>${p.kda}</td><td style="color:var(--accent-color);font-weight:bold;">${p.points}</td></tr>`; 
    });
}

function sortTops(column) {
    if (currentSortColumn === column) { currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc'; } 
    else { currentSortColumn = column; currentSortDirection = 'desc'; }
    renderTops();
}

// ==================== ФОРМЫ ====================
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

function fillPlayerSelects() {
    const select = document.getElementById('fine-player'); if (!select) return;
    select.innerHTML = '<option value="">-- Выберите игрока --</option>';
    AppState.activePlayers.forEach(p => { const o = document.createElement('option'); o.value = p.id; o.textContent = p.nickname; select.appendChild(o); });
    initSearchableSelect('fine-player', 'up');
}

function renderPlayerList(filterText = '') {
    const container = document.getElementById('player-list-container'); if (!container) return;
    container.innerHTML = '';
    const searchLower = filterText.toLowerCase().trim();
    let filtered = AppState.players.filter(p => (p.nickname && p.nickname.toLowerCase().includes(searchLower)) || (p.discord_id && p.discord_id.toString().toLowerCase().includes(searchLower)));
    filtered.sort((a, b) => {
        const sA = a.status ? a.status.toLowerCase() : 'в клане', sB = b.status ? b.status.toLowerCase() : 'в клане';
        return (STATUS_PRIORITY[sA] || 2) !== (STATUS_PRIORITY[sB] || 2) ? (STATUS_PRIORITY[sA] || 2) - (STATUS_PRIORITY[sB] || 2) : a.nickname.localeCompare(b.nickname); 
    });
    if (filtered.length === 0) { container.innerHTML = '<div style="text-align:center; color:#888; padding: 20px;">Никого не найдено</div>'; return; }
    filtered.forEach(p => {
        const div = document.createElement('div'); div.className = `player-item ${currentEditId === p.id ? 'active' : ''}`;
        let sColor = 'var(--success-color)'; if (p.status === 'в обработке') sColor = 'var(--accent-color)'; if (p.status === 'кикнут') sColor = 'var(--danger-color)';
        div.innerHTML = `<div style="display:flex; flex-direction:column;"><span style="font-weight:bold;">${p.nickname}</span><span style="font-size:0.75em; color:${sColor};">${p.status || 'в клане'}</span></div><span style="color:#888; font-size:0.8em;">${p.discord_id || 'ID: ' + p.id}</span>`;
        div.onclick = () => selectPlayer(p); container.appendChild(div);
    });
}

function filterPlayerList() { const i = document.getElementById('player-search-input'); if (i) renderPlayerList(i.value); }

async function selectPlayer(p) {
    currentEditId = p.id;
    document.getElementById('form-title').innerText = "Редактирование: " + p.nickname;
    document.getElementById('edit-player-id').value = p.id;
    document.getElementById('profile-nickname').value = p.nickname || '';
    document.getElementById('profile-discord-id').value = p.discord_id || '';
    document.getElementById('profile-sledgehammer').checked = p.has_sledgehammer || false;
    document.getElementById('profile-speed-combat').value = p.speed_combat || ''; 
    document.getElementById('profile-penetration-combat').value = p.penetration_combat || '';
    document.getElementById('profile-speed-combined').value = p.speed_combined || ''; 
    document.getElementById('profile-penetration-combined').value = p.penetration_combined || '';

    ['select-rifle','select-smg','select-sniper','select-pistol','select-machine-gun','select-shotgun','select-armor-combat','select-armor-combined','profile-status','profile-squad','profile-role'].forEach(id => {
        const el = document.getElementById(id);
        const val = id === 'profile-squad' ? (p.squad || '') : id === 'profile-role' ? (p.role || '') : id === 'profile-status' ? (p.status || 'в клане') : id === 'select-rifle' ? (p.main_rifle || '') : id === 'select-smg' ? (p.main_smg || '') : id === 'select-sniper' ? (p.sniper || '') : id === 'select-pistol' ? (p.secondary_pistol || '') : id === 'select-machine-gun' ? (p.machine_gun || '') : id === 'select-shotgun' ? (p.shotgun || '') : id === 'select-armor-combat' ? (p.armor_combat || '') : id === 'select-armor-combined' ? (p.armor_combined || '') : '';
        if (el.tomselect) { el.tomselect.setValue(val, true); } else { el.value = val; }
    });

    document.getElementById('btn-delete').style.display = 'block';
    renderPlayerList();
    
    const st = computeSeasonStats(p.id);
    document.getElementById('profile-kd').value = st.kd;
    document.getElementById('profile-kda').value = st.kda;
    document.getElementById('profile-points').value = st.points;

    const missed = AppState.attendance.filter(a => a.player_id === p.id && a.status === 'Не пришел');
    const missedBox = document.getElementById('player-missed-stats');
    if (missedBox) { missedBox.style.display = 'block'; document.getElementById('pm-absent').innerText = missed.length; }
}

function clearForm() {
    const s = document.getElementById('player-search-input'); if (s) s.value = ''; 
    currentEditId = null; document.getElementById('form-title').innerText = "Новый боец";
    document.getElementById('edit-player-id').value = '';
    ['nickname','discord-id','kd','kda','points','speed-combat','penetration-combat','speed-combined','penetration-combined'].forEach(f => document.getElementById('profile-'+f).value = '');
    document.getElementById('profile-sledgehammer').checked = false;
    ['select-rifle','select-smg','select-sniper','select-pistol','select-machine-gun','select-shotgun','select-armor-combat','select-armor-combined','profile-status','profile-squad','profile-role'].forEach(id => {
        const el = document.getElementById(id);
        if (el.tomselect) { el.tomselect.clear(true); } else { el.value = ''; }
    });
    document.getElementById('btn-delete').style.display = 'none';
    document.getElementById('player-missed-stats').style.display = 'none';
    renderPlayerList();
}

async function saveProfile() {
    if (!canEdit()) { showToast('Только в активном сезоне', 'error'); return; }
    const nick = document.getElementById('profile-nickname').value.trim(); if (!nick) return showToast('Введите ник!', 'error');
    const selectedSquad = document.getElementById('profile-squad').value;
    const selectedRole = document.getElementById('profile-role').value;

    if (selectedSquad && selectedRole) {
        const existing = AppState.players.find(x => x.squad === selectedSquad && x.role === selectedRole && x.id !== currentEditId);
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
        speed_combat: parseInt(document.getElementById('profile-speed-combat').value) || 0,
        penetration_combat: parseInt(document.getElementById('profile-penetration-combat').value) || 0,
        speed_combined: parseInt(document.getElementById('profile-speed-combined').value) || 0,
        penetration_combined: parseInt(document.getElementById('profile-penetration-combined').value) || 0,
        status: document.getElementById('profile-status').value, squad: selectedSquad || null, role: selectedRole || null
    };
    
    let error;
    if (currentEditId) { const res = await supabaseClient.from('players').update(data).eq('id', currentEditId); error = res.error; }
    else { const res = await supabaseClient.from('players').insert([data]); error = res.error; }
    
    if (error) showToast('Ошибка: ' + error.message, 'error'); 
    else { showToast('Профиль сохранён!', 'success'); await refreshAll(); clearForm(); }
}

async function deletePlayer() {
    if (!canEdit()) return;
    if (!currentEditId || !confirm('Удалить игрока?')) return;
    const { error } = await supabaseClient.from('players').delete().eq('id', currentEditId);
    if (error) showToast('Ошибка: ' + error.message, 'error'); 
    else { showToast('Игрок удалён', 'success'); await refreshAll(); clearForm(); }
}

async function loadMyProfile(player) {
    if (!player) return;
    document.getElementById('my-profile-content').style.display = 'block';
    const st = computeSeasonStats(player.id);
    document.getElementById('my-kd').innerText = st.kd;
    document.getElementById('my-kda').innerText = st.kda;
    document.getElementById('my-points').innerText = st.points;
    document.getElementById('my-squad').innerText = player.squad ? `${player.squad} (${player.role})` : 'Не в отряде';
    const statusEl = document.getElementById('my-status');
    if (statusEl) {
        statusEl.innerText = player.status || 'в клане';
        statusEl.style.color = player.status === 'в обработке' ? 'var(--accent-color)' : (player.status === 'кикнут' ? 'var(--danger-color)' : 'var(--success-color)');
    }
    const fines = AppState.fines.filter(f => f.player_id === player.id);
    const fBody = document.getElementById('my-fines-body');
    fBody.innerHTML = fines.length === 0 ? '<tr><td colspan="3" style="text-align:center;">Штрафов нет</td></tr>' : '';
    fines.forEach(f => { fBody.innerHTML += `<tr><td>${f.reason}</td><td style="color:var(--danger-color);">${f.amount} ₽</td><td class="${f.status === 'open' ? 'status-open' : 'status-closed'}">${f.status === 'open' ? 'Открыт' : 'Закрыт'}</td></tr>`; });
    
    const myAtt = AppState.attendance.filter(a => a.player_id === player.id);
    const max = getMaxStage();
    const th = document.getElementById('my-attendance-thead'); let hH = '<tr><th>Игрок</th>';
    for (let i = 1; i <= max; i++) hH += `<th>Этап ${i}</th>`; th.innerHTML = hH + '</tr>';
    const tb = document.getElementById('my-attendance-body'); let row = `<tr><td><strong>${player.nickname}</strong></td>`;
    for (let t = 1; t <= max; t++) {
        const r = myAtt.find(a => a.tournament_number === t); const s = r ? r.status : 'Не отмечен';
        let c = s === 'Пришел' ? 'status-1' : (s === 'Не пришел' ? 'status-2' : (s === 'Отгул' ? 'status-3' : ''));
        row += `<td class="${c}">${s === 'Не отмечен' ? '-' : s}</td>`;
    }
    tb.innerHTML = row + '</tr>';
}

// ==================== СОСТАВ ====================
function initDragAndDrop(filterText = '') {
    const board = document.getElementById('roster-board'); if (!board) return; board.innerHTML = '';
    SQUADS_CONFIG.forEach(sq => {
        const card = document.createElement('div'); card.className = 'squad-card'; let rH = '';
        sq.roles.forEach(role => {
            const a = AppState.activePlayers.find(p => p.squad === sq.name && p.role === role);
            const n = a ? `<span style="cursor:pointer; color:var(--accent-color); text-decoration:underline;" onclick="event.stopPropagation(); goToPlayerProfile(${a.id})">${a.nickname}</span>` : 'Свободно';
            const c = a ? 'player-name' : 'empty-slot', id = a ? a.id : '';
            const rB = (a && canEdit()) ? `<button class="btn btn-danger" style="padding: 2px 6px; font-size: 0.7em; margin-left: 5px;" onclick="event.stopPropagation(); removeFromSquad(${a.id})">➖</button>` : '';
            const displayRole = role.replace(' 1', '').replace(' 2', '').replace(' 3', '');
            rH += `<div class="role-slot" data-squad="${sq.name}" data-role="${role}" data-player-id="${id}" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event, this)"><span>${displayRole}</span><span class="${c}">${n} ${rB}</span></div>`;
        });
        card.innerHTML = `<div class="squad-title">${sq.name}</div>${rH}`; board.appendChild(card);
    });

    const freeList = document.getElementById('free-players-list'); if (!freeList) return; freeList.innerHTML = '';
    freeList.ondragover = (e) => e.preventDefault();
    freeList.ondrop = async (e) => {
        e.preventDefault(); if (!canEdit()) return; const id = e.dataTransfer.getData('text/plain');
        if (id) { await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id); await refreshAll(); initDragAndDrop(); }
    };
    
    const searchLower = filterText.toLowerCase().trim();
    const free = AppState.activePlayers.filter(p => !p.squad && p.nickname.toLowerCase().includes(searchLower));
    
    if (free.length === 0) freeList.innerHTML = '<div style="text-align:center; color:#555;">Никого не найдено</div>';
    else free.forEach(p => {
        const i = document.createElement('div'); i.className = 'free-player-item'; i.draggable = canEdit();
        i.ondragstart = (e) => { e.dataTransfer.setData('text/plain', p.id); i.classList.add('dragging'); };
        i.ondragend = () => i.classList.remove('dragging'); i.innerHTML = `<span>${p.nickname}</span>`; freeList.appendChild(i);
    });
}

async function handleDrop(event, slot) {
    event.preventDefault(); slot.classList.remove('drag-over'); if (!canEdit()) return;
    const id = event.dataTransfer.getData('text/plain'), sq = slot.dataset.squad, role = slot.dataset.role, ex = slot.dataset.playerId;
    if (!id) return; 
    if (ex && ex !== '') await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', ex);
    await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id);
    const { error } = await supabaseClient.from('players').update({ squad: sq, role: role }).eq('id', id);
    if (!error) { await refreshAll(); initDragAndDrop(); showToast('Игрок перемещён', 'success'); }
}

async function removeFromSquad(id) {
    if (!canEdit() || !confirm('Убрать игрока из отряда?')) return;
    await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id);
    await refreshAll(); initDragAndDrop();
}

// ==================== ПОСЕЩАЕМОСТЬ ====================
async function loadAttendance() {
    const max = getMaxStage();

    const s = document.getElementById('modal-stage');
    if (s) {
        s.innerHTML = '';
        const totalTournaments = Math.max(AppState.tournaments.length, Math.ceil(max / STAGES_PER_TOURNAMENT));
        for (let t = 1; t <= totalTournaments; t++) {
            const og = document.createElement('optgroup');
            og.label = `Турнир ${t}`;
            for (let i = (t - 1) * STAGES_PER_TOURNAMENT + 1; i <= t * STAGES_PER_TOURNAMENT && i <= max; i++) {
                const o = document.createElement('option');
                o.value = i; o.textContent = `Этап ${i}`;
                og.appendChild(o);
            }
            s.appendChild(og);
        }
    }
    
    const th = document.getElementById('attendance-thead'); if (!th) return;
    let h = '<tr class="day-brackets-row"><th></th>', tC = Math.ceil(max / STAGES_PER_TOURNAMENT);
    for (let t = 0; t < tC; t++) { const st = Math.min(STAGES_PER_TOURNAMENT, max - t * STAGES_PER_TOURNAMENT); h += `<th colspan="${st}" style="border: 2px solid var(--accent-color); border-bottom: none; border-radius: var(--radius) var(--radius) 0 0; color: var(--accent-color); font-weight: bold; text-align: center;">ТУРНИР ${t + 1}</th>`; }
    h += '</tr><tr><th>Боец</th>'; for (let i = 1; i <= max; i++) h += `<th>ЭТАП ${i}</th>`; th.innerHTML = h + '</tr>';
    
    const tb = document.getElementById('attendance-table-body'); if (!tb) return; tb.innerHTML = '';
    const searchInput = document.getElementById('attendance-search');
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const filtered = AppState.activePlayers.filter(p => p.nickname.toLowerCase().includes(searchQuery));

    filtered.forEach(p => {
        let row = `<tr><td>${p.nickname}</td>`;
        for (let t = 1; t <= max; t++) {
            const r = AppState.attendance.find(a => a.player_id === p.id && a.tournament_number === t);
            const st = r ? r.status : 'Не отмечен';
            let c = st === 'Пришел' ? 'status-1' : (st === 'Не пришел' ? 'status-2' : (st === 'Отгул' ? 'status-3' : ''));
            row += `<td><select class="${c}" ${!canEdit() ? 'disabled' : ''} onchange="updateAttendance(${p.id}, ${t}, this.value)"><option value="Не отмечен" ${st === 'Не отмечен' ? 'selected' : ''}>-</option><option value="Пришел" ${st === 'Пришел' ? 'selected' : ''}>Пришел</option><option value="Не пришел" ${st === 'Не пришел' ? 'selected' : ''}>Не пришел</option><option value="Отгул" ${st === 'Отгул' ? 'selected' : ''}>Отгул</option></select></td>`;
        }
        tb.innerHTML += row + '</tr>';
    });

    const atc = document.getElementById('att-tournament-count');
    const asc = document.getElementById('att-stage-count');
    if (atc) atc.innerText = Math.ceil(max / STAGES_PER_TOURNAMENT);
    if (asc) asc.innerText = max;
}

async function updateAttendance(id, t, s) {
    if (!canEdit()) return;
    const sid = AppState.viewingSeason.id;
    if (s === 'Не отмечен') {
        await supabaseClient.from('attendance').delete().eq('player_id', id).eq('tournament_number', t).eq('season_id', sid);
    } else {
        await supabaseClient.from('attendance').upsert({ player_id: id, tournament_number: t, status: s, season_id: sid }, { onConflict: 'season_id, player_id, tournament_number' });
    }
    await refreshAttendance();
    loadAttendance();
}

async function loadAllMissed() {
    const tbody = document.getElementById('missed-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Загрузка...</td></tr>';

    const missed = AppState.attendance.filter(a => a.status === 'Не пришел');
    if (missed.length === 0) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--success-color);">Прогулов нет.</td></tr>'; return; }

    const grouped = {};
    missed.forEach(item => {
        const pId = item.player_id;
        const player = AppState.players.find(p => p.id === pId);
        const nick = player ? player.nickname : 'Удалённый игрок';
        if (!grouped[pId]) grouped[pId] = { id: pId, nickname: nick, stages: [] };
        grouped[pId].stages.push(item.tournament_number);
    });

    tbody.innerHTML = '';
    const sorted = Object.values(grouped).sort((a, b) => b.stages.length - a.stages.length);

    sorted.forEach(p => {
        const groupedStages = {};
        p.stages.forEach(s => {
            const tourney = Math.ceil(s / STAGES_PER_TOURNAMENT);
            const stageInTourney = s % STAGES_PER_TOURNAMENT === 0 ? STAGES_PER_TOURNAMENT : s % STAGES_PER_TOURNAMENT;
            if (!groupedStages[tourney]) groupedStages[tourney] = [];
            groupedStages[tourney].push({ globalStage: s, stageInTourney });
        });

        const stagesHtml = Object.keys(groupedStages).map(t => {
            const list = groupedStages[t].sort((a,b)=>a.stageInTourney-b.stageInTourney).map(item => {
                return `<div style="display:inline-flex; align-items:center; gap:5px; background:var(--input-bg); padding:4px 8px; border-radius:var(--radius); border:1px solid var(--border-color); margin-right:10px; margin-bottom:5px;">
                    <span style="font-size:0.85em; color:var(--text-muted);">Э${item.stageInTourney}:</span>
                    <select class="missed-select" ${!canEdit() ? 'disabled' : ''} style="padding:2px 5px; border:none; background:transparent; color:var(--accent-color); outline:none; cursor:pointer; font-size:0.85em;" onchange="updateMissedStatus(${p.id}, ${item.globalStage}, this.value)">
                        <option value="Не пришел" selected>Не пришел</option>
                        <option value="Отгул">Отгул</option>
                        <option value="Пришел">Пришел</option>
                        <option value="Удалить">Удалить</option>
                    </select>
                </div>`;
            }).join('');
            return `<div style="display:flex; align-items:center; margin-bottom:10px; flex-wrap:wrap;">
                        <div style="font-weight:bold; color:var(--text-muted); min-width:90px;">Турнир ${t}:</div>
                        <div style="display:flex; flex-wrap:wrap;">${list}</div>
                    </div>`;
        }).join('');

        tbody.innerHTML += `<tr>
            <td style="vertical-align:top; padding-top:15px;"><strong>${p.nickname}</strong></td>
            <td style="vertical-align:top; padding-top:15px; color:var(--danger-color); font-weight:bold; text-align:center; font-size:1.2em;">${p.stages.length}</td>
            <td style="text-align:left; line-height:1.4; padding:10px;">${stagesHtml}</td>
        </tr>`;
    });
}

async function updateMissedStatus(playerId, globalStage, newStatus) {
    if (!canEdit()) return;
    const sid = AppState.viewingSeason.id;
    if (newStatus === 'Удалить') {
        await supabaseClient.from('attendance').delete().eq('player_id', playerId).eq('tournament_number', globalStage).eq('season_id', sid);
    } else {
        await supabaseClient.from('attendance').upsert({ player_id: playerId, tournament_number: globalStage, status: newStatus, season_id: sid }, { onConflict: 'season_id, player_id, tournament_number' });
    }
    await refreshAttendance();
    await loadAllMissed();
    loadAttendance();
}

// ==================== СТАТИСТИКА ====================
async function loadMatchStats() {
    const max = getMaxStage();
    const th = document.getElementById('stats-thead'); if (!th) return;
    
    let h = '<tr><th rowspan="2" style="vertical-align:middle;">Боец</th>';
    let tC = Math.ceil(max / STAGES_PER_TOURNAMENT);
    for (let t = 0; t < tC; t++) { const st = Math.min(STAGES_PER_TOURNAMENT, max - t * STAGES_PER_TOURNAMENT); h += `<th colspan="${st * 4}" style="border-bottom:1px solid var(--border-color); text-align:center;">ТУРНИР ${t + 1}</th>`; }
    h += '</tr><tr>';
    for (let i = 1; i <= max; i++) h += `<th colspan="4" style="text-align:center; color:var(--accent-color);">ЭТАП ${i}</th>`;
    h += '</tr><tr><th></th>'; 
    for (let i = 1; i <= max; i++) h += `<th style="font-size:0.75em; color:var(--text-muted);">K</th><th style="font-size:0.75em; color:var(--text-muted);">D</th><th style="font-size:0.75em; color:var(--text-muted);">A</th><th style="font-size:0.75em; color:var(--text-muted);">PTS</th>`;
    h += '</tr>';
    th.innerHTML = h;

    const tb = document.getElementById('stats-tbody'); if (!tb) return; tb.innerHTML = '';
    const searchInput = document.getElementById('stats-search');
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const filtered = AppState.activePlayers.filter(p => p.nickname.toLowerCase().includes(searchQuery));
    const disabledAttr = !canEdit() ? 'disabled' : '';

    filtered.forEach(p => {
        let row = `<tr><td>${p.nickname}</td>`;
        for (let i = 1; i <= max; i++) {
            const r = AppState.matchStats.find(x => x.player_id === p.id && x.stage_number === i);
            row += `<td><input type="number" ${disabledAttr} value="${r ? r.kills : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'kills', this.value)" style="width:45px;"></td>
                <td><input type="number" ${disabledAttr} value="${r ? r.deaths : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'deaths', this.value)" style="width:45px;"></td>
                <td><input type="number" ${disabledAttr} value="${r ? r.assists : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'assists', this.value)" style="width:45px;"></td>
                <td><input type="number" ${disabledAttr} value="${r ? r.points : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'points', this.value)" style="width:55px;"></td>`;
        }
        tb.innerHTML += row + '</tr>';
    });

    const stc = document.getElementById('stats-tournament-count');
    const ssc = document.getElementById('stats-stage-count');
    if (stc) stc.innerText = Math.ceil(max / STAGES_PER_TOURNAMENT);
    if (ssc) ssc.innerText = max;
}

async function updateMatchStat(playerId, stageNum, field, value) {
    if (!canEdit()) return;
    const sid = AppState.viewingSeason.id;
    const numVal = parseInt(value) || 0;
    const existing = AppState.matchStats.find(x => x.player_id === playerId && x.stage_number === stageNum);
    
    let payload = { player_id: playerId, stage_number: stageNum, season_id: sid };
    if (existing) payload = { ...existing, [field]: numVal };
    else {
        payload.kills = field === 'kills' ? numVal : 0;
        payload.deaths = field === 'deaths' ? numVal : 0;
        payload.assists = field === 'assists' ? numVal : 0;
        payload.points = field === 'points' ? numVal : 0;
    }
    await supabaseClient.from('match_stats').upsert(payload, { onConflict: 'season_id, player_id, stage_number' });
    await refreshMatchStats();
    await recalculatePlayerStats(playerId);
}

async function recalculatePlayerStats(playerId) {
    if (!playerId) return;
    const { data: allStats } = await supabaseClient.from('match_stats').select('*').eq('player_id', playerId);
    if (allStats && allStats.length > 0) {
        let tK = 0, tD = 0, tA = 0, tP = 0;
        allStats.forEach(s => { tK += s.kills || 0; tD += s.deaths || 0; tA += s.assists || 0; tP += s.points || 0; });
        let kd = tD === 0 ? tK : (tK / tD), kda = tD === 0 ? (tK + tA) : ((tK + tA) / tD);
        kd = Math.round(kd * 100) / 100; kda = Math.round(kda * 100) / 100;
        await supabaseClient.from('players').update({ kd, kda, points: tP }).eq('id', playerId);
        const p = AppState.players.find(x => x.id === playerId);
        if (p) { p.kd = kd; p.kda = kda; p.points = tP; }
        renderTops();
    }
}

// ==================== ТУРНИРЫ ====================
async function addTournament() {
    if (!canEdit()) { showToast('Только в активном сезоне', 'error'); return; }
    const sid = AppState.activeSeason.id;
    const nextNum = AppState.tournaments.length > 0 ? Math.max(...AppState.tournaments.map(t => t.tournament_number)) + 1 : 1;

    if (nextNum > TOURNAMENTS_PER_SEASON) {
        if (!confirm(`В сезоне уже ${TOURNAMENTS_PER_SEASON} турниров. Начать новый сезон?`)) return;
        return startNewSeason();
    }

    const { error } = await supabaseClient.from('tournaments').insert([{ tournament_number: nextNum, season_id: sid }]);
    if (error) { showToast('Ошибка: ' + error.message, 'error'); return; }

    await refreshTournaments();
    showToast(`Турнир ${nextNum} добавлен (этапы ${nextNum*3-2}–${nextNum*3})`, 'success');
    const active = document.querySelector('.tab-content.active');
    if (active && active.id === 'tab-attendance') loadAttendance();
    if (active && active.id === 'tab-stats') loadMatchStats();
    if (active && active.id === 'tab-calendar') loadCalendar();
}

async function deleteTournament() {
    if (!canEdit()) return;
    if (AppState.tournaments.length === 0) { showToast('Нет турниров', 'error'); return; }
    const lastNum = Math.max(...AppState.tournaments.map(t => t.tournament_number));
    if (lastNum <= 1) { showToast('Нельзя удалить турнир 1', 'error'); return; }
    if (!confirm(`Удалить турнир ${lastNum} (этапы ${lastNum*3-2}–${lastNum*3}) и все связанные данные?`)) return;

    const sid = AppState.viewingSeason.id;
    for (let s = lastNum * 3 - 2; s <= lastNum * 3; s++) {
        await supabaseClient.from('attendance').delete().eq('tournament_number', s).eq('season_id', sid);
        await supabaseClient.from('match_stats').delete().eq('stage_number', s).eq('season_id', sid);
        await supabaseClient.from('clan_matches').delete().eq('stage_number', s).eq('season_id', sid);
    }
    await supabaseClient.from('upcoming_matches').delete().eq('tournament_number', lastNum).eq('season_id', sid);
    await supabaseClient.from('tournaments').delete().eq('tournament_number', lastNum).eq('season_id', sid);

    await refreshTournaments();
    await refreshUpcoming();
    await refreshAttendance();
    await refreshMatchStats();
    await refreshMatches();
    showToast(`Турнир ${lastNum} удалён`, 'success');
    const active = document.querySelector('.tab-content.active');
    if (active && active.id === 'tab-attendance') loadAttendance();
    if (active && active.id === 'tab-stats') loadMatchStats();
    if (active && active.id === 'tab-history') loadMatchHistory();
    if (active && active.id === 'tab-calendar') loadCalendar();
}

function addStage()    { addTournament(); }
function deleteStage() { deleteTournament(); }

// ==================== СРАВНЕНИЕ ====================
let compareSelection = [];

function initCompareTab() {
    const p1Select = document.getElementById('compare-players');
    if (!p1Select) return;
    if (p1Select.tomselect) p1Select.tomselect.destroy();

    p1Select.innerHTML = '';
    AppState.activePlayers.forEach(p => {
        const o = document.createElement('option');
        o.value = p.id; o.textContent = p.nickname;
        p1Select.appendChild(o);
    });

    new TomSelect(p1Select, {
        create: false, maxItems: 4,
        sortField: { field: "text", direction: "asc" },
        plugins: ['remove_button'],
        onChange: () => renderComparison()
    });

    const periodSel = document.getElementById('compare-period');
    if (periodSel) {
        if (periodSel.tomselect) periodSel.tomselect.destroy();
        const max = getMaxStage();
        let opts = '<option value="all">Всё время (сезон)</option>';
        for (let t = 1; t <= Math.ceil(max / STAGES_PER_TOURNAMENT); t++) opts += `<option value="t${t}">Турнир ${t}</option>`;
        for (let s = 1; s <= max; s++) opts += `<option value="s${s}">Только этап ${s}</option>`;
        periodSel.innerHTML = opts;
        new TomSelect(periodSel, { create: false, maxItems: 1, onChange: () => renderComparison() });
    }
}

function getCompareStatsForPeriod(playerId, period) {
    let stats = AppState.matchStats.filter(s => s.player_id === playerId);
    if (period && period !== 'all') {
        if (period.startsWith('t')) {
            const t = parseInt(period.slice(1));
            const from = (t - 1) * STAGES_PER_TOURNAMENT + 1;
            const to = t * STAGES_PER_TOURNAMENT;
            stats = stats.filter(s => s.stage_number >= from && s.stage_number <= to);
        } else if (period.startsWith('s')) {
            const s = parseInt(period.slice(1));
            stats = stats.filter(x => x.stage_number === s);
        }
    }
    let k = 0, d = 0, a = 0, p = 0;
    stats.forEach(s => { k += s.kills || 0; d += s.deaths || 0; a += s.assists || 0; p += s.points || 0; });
    const kd = d === 0 ? k : k / d;
    const kda = d === 0 ? (k + a) : (k + a) / d;
    const att = AppState.attendance.filter(x => x.player_id === playerId);
    const came = att.filter(x => x.status === 'Пришел').length;
    const missed = att.filter(x => x.status === 'Не пришел').length;
    return { kd: Math.round(kd * 100) / 100, kda: Math.round(kda * 100) / 100, points: p, games: stats.length, came, missed };
}

function renderComparison() {
    const ids = Array.from(document.getElementById('compare-players').selectedOptions).map(o => parseInt(o.value));
    const period = document.getElementById('compare-period')?.value || 'all';
    const container = document.getElementById('compare-results');
    if (!container) return;

    if (ids.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding:20px; text-transform:uppercase;">Выберите одного или нескольких бойцов</div>';
        return;
    }

    const players = ids.map(id => AppState.players.find(x => x.id === id)).filter(Boolean);
    const statData = players.map(p => ({ player: p, stats: getCompareStatsForPeriod(p.id, period) }));

    const metrics = ['КД', 'КДА', 'Очки'];
    const colors = ['#4caf50', '#ff9800', '#2196f3', '#e91e63'];

    const kdValues = statData.map(d => d.stats.kd);
    const kdaValues = statData.map(d => d.stats.kda);
    const ptsValues = statData.map(d => d.stats.points);
    const normalize = arr => { const m = Math.max(...arr, 1); return arr.map(v => Math.round((v / m) * 1000) / 10); };
    const kdN = normalize(kdValues), kdaN = normalize(kdaValues), ptsN = normalize(ptsValues);

    const canvasId = 'compareChart';
    const chartHtml = `<div style="width:100%; height:300px; margin-bottom:20px;"><canvas id="${canvasId}"></canvas></div>`;

    let tableHtml = '<table class="compare-table"><thead><tr><th>Характеристика</th>';
    players.forEach(p => { tableHtml += `<th>${p.nickname}${p.squad ? ` <span style="color:var(--text-muted); font-size:0.8em;">(${p.squad})</span>` : ''}</th>`; });
    tableHtml += '</tr></thead><tbody>';

    const rowFor = (label, values, isHigherBetter = true) => {
        const nums = values.map(v => parseFloat(v) || 0);
        const best = isHigherBetter ? Math.max(...nums) : Math.min(...nums);
        return `<tr><td>${label}</td>` + values.map((v, i) => `<td class="${nums[i] === best && nums.length > 1 ? 'compare-winner' : ''}">${v}</td>`).join('') + '</tr>';
    };

    tableHtml += rowFor('КД', statData.map(d => d.stats.kd));
    tableHtml += rowFor('КДА', statData.map(d => d.stats.kda));
    tableHtml += rowFor('Очки', statData.map(d => d.stats.points));
    tableHtml += rowFor('Сыграно', statData.map(d => d.stats.games));
    tableHtml += rowFor('Прогулы', statData.map(d => d.stats.missed), false);
    tableHtml += rowFor('Посещаемость', statData.map(d => {
        const t = d.stats.came + d.stats.missed;
        return t === 0 ? '—' : Math.round((d.stats.came / t) * 100) + '%';
    }));
    tableHtml += rowFor('Кувалда', players.map(p => p.has_sledgehammer ? '🔨' : '❌'));
    tableHtml += rowFor('Автомат', players.map(p => p.main_rifle || '-'));
    tableHtml += rowFor('ПП', players.map(p => p.main_smg || '-'));
    tableHtml += rowFor('Снайперка', players.map(p => p.sniper || '-'));
    tableHtml += rowFor('Пистолет', players.map(p => p.secondary_pistol || '-'));
    tableHtml += rowFor('Пулемёт', players.map(p => p.machine_gun || '-'));
    tableHtml += rowFor('Дробовик', players.map(p => p.shotgun || '-'));
    tableHtml += rowFor('Боевая броня', players.map(p => p.armor_combat || '-'));
    tableHtml += rowFor('Комбинированная', players.map(p => p.armor_combined || '-'));
    tableHtml += '</tbody></table>';

    container.innerHTML = chartHtml + tableHtml;

    if (compareChart) compareChart.destroy();
    compareChart = new Chart(document.getElementById(canvasId), {
        type: 'bar',
        data: {
            labels: metrics,
            datasets: statData.map((d, i) => ({
                label: d.player.nickname,
                data: [kdN[i], kdaN[i], ptsN[i]],
                backgroundColor: colors[i % colors.length],
                borderColor: '#0d0f0d',
                borderWidth: 1
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { color: '#d1d5d1', callback: v => v + '%' }, grid: { color: '#2a3a2a' } },
                x: { ticks: { color: '#d1d5d1', font: { weight: 'bold' } }, grid: { color: '#2a3a2a' } }
            },
            plugins: {
                legend: { labels: { color: '#d1d5d1', font: { family: 'Courier New', weight: 'bold' } } },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const raw = [kdValues[ctx.datasetIndex], kdaValues[ctx.datasetIndex], ptsValues[ctx.datasetIndex]][ctx.dataIndex];
                            return `${ctx.dataset.label}: ${raw} (${ctx.parsed.y}%)`;
                        }
                    }
                }
            }
        }
    });
}

// ==================== MVP ТУРНИРОВ ====================
function renderTournamentMVPs() {
    const container = document.getElementById('tournament-mvp-container');
    if (!container) return;
    
    // Показываем только завершенные турниры (где есть хотя бы 1 матч)
    const activeTournaments = AppState.tournaments.filter(t => {
        const startStage = (t.tournament_number - 1) * STAGES_PER_TOURNAMENT + 1;
        return AppState.matchStats.some(s => s.stage_number >= startStage && s.stage_number <= startStage + STAGES_PER_TOURNAMENT - 1);
    });

    if (activeTournaments.length === 0) {
        container.innerHTML = '';
        return;
    }

    let html = '<h3 style="color:var(--accent-color); text-transform:uppercase; margin-bottom:15px; text-align:center; font-size:1.2em;">👑 MVP по турнирам</h3>';
    html += '<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(220px, 1fr)); gap:15px; margin-bottom:30px;">';

    activeTournaments.forEach(t => {
        const startStage = (t.tournament_number - 1) * STAGES_PER_TOURNAMENT + 1;
        const endStage = t.tournament_number * STAGES_PER_TOURNAMENT;
        
        const tStats = AppState.matchStats.filter(s => s.stage_number >= startStage && s.stage_number <= endStage);
        
        const playerPoints = {};
        tStats.forEach(s => {
            if (!playerPoints[s.player_id]) playerPoints[s.player_id] = 0;
            playerPoints[s.player_id] += (s.points || 0);
        });

        let mvpId = null;
        let maxPoints = -1;
        for (const [pid, pts] of Object.entries(playerPoints)) {
            if (pts > maxPoints) { maxPoints = pts; mvpId = parseInt(pid); }
        }

        if (mvpId) {
            const p = AppState.players.find(x => x.id === mvpId);
            if (p) {
                html += `
                    <div class="calendar-card" style="border-color:var(--accent-color); background:rgba(255,152,0,0.05); text-align:center;">
                        <div style="font-size:0.8em; color:var(--text-muted); text-transform:uppercase;">Турнир ${t.tournament_number}</div>
                        <div style="font-size:1.3em; font-weight:bold; color:var(--text-color); margin:5px 0;">${p.nickname}</div>
                        <div style="color:var(--success-color); font-weight:bold; font-family:'Courier New', monospace;">${maxPoints} очков</div>
                    </div>
                `;
            }
        }
    });
    html += '</div>';
    container.innerHTML = html;
}

// ==================== ИСТОРИЯ ====================
async function loadMatchHistory() {
    const timeline = document.getElementById('history-timeline');
    if (!timeline) return;
    timeline.innerHTML = '<div style="text-align:center; width:100%;">Загрузка...</div>';

    renderTournamentMVPs(); // <--- Вызов рендера MVP

    const matchesByStage = {};
    AppState.matches.forEach(m => { if (m.stage_number) matchesByStage[m.stage_number] = m; });

    const totalStages = getMaxStage();
    const tCountEl = document.getElementById('history-tournament-count');
    const sCountEl = document.getElementById('history-stage-count');
    if (tCountEl) tCountEl.innerText = Math.ceil(totalStages / STAGES_PER_TOURNAMENT);
    if (sCountEl) sCountEl.innerText = totalStages;

    const sortedMatches = [...AppState.matches].filter(m => m.stage_number).sort((a, b) => a.stage_number - b.stage_number);
    let currentRating = START_RATING;
    const matchRatings = {}; 
    
    sortedMatches.forEach(m => {
        let change = 0;
        const c = m.clan_score || 0;
        const e = m.enemy_points || 0;
        if (c > e) change = RATING_CHANGE;
        else if (c < e) change = -RATING_CHANGE;
        
        currentRating += change;
        matchRatings[m.id] = { change, total: currentRating };
    });

    const ratingEl = document.getElementById('hr-rating');
    if (ratingEl) {
        ratingEl.innerText = currentRating;
        if (currentRating > START_RATING) ratingEl.style.color = 'var(--success-color)';
        else if (currentRating < START_RATING) ratingEl.style.color = 'var(--danger-color)';
        else ratingEl.style.color = 'var(--accent-color)';
    }

    let wins = 0, losses = 0, draws = 0;
    timeline.innerHTML = '';

    if (totalStages === 0) {
        timeline.innerHTML = '<div style="text-align:center; width:100%; padding:30px; color:var(--text-muted);">Нет турниров.</div>';
        renderHistoryChart(0, 0, 0);
        return;
    }

    const stageOrder = [];
    for (let s = totalStages; s >= 1; s--) stageOrder.push(s);

    stageOrder.forEach((stageNum, index) => {
        const match = matchesByStage[stageNum];
        const isLeft = index % 2 === 0;
        const tourneyNum = Math.ceil(stageNum / STAGES_PER_TOURNAMENT);

        if (match) {
            const dateStr = match.match_date ? new Date(match.match_date + 'T00:00:00').toLocaleDateString('ru-RU') : 'Дата не указана';
            const cScore = match.clan_score || 0;
            const eScore = match.enemy_points || 0;
            const opponent = match.enemy_name || 'Неизвестный враг';

            let scoreClass = '', winText = '';
            if (cScore > eScore) { scoreClass = 'score-win'; winText = 'ПОБЕДА'; wins++; }
            else if (cScore < eScore) { scoreClass = 'score-loss'; winText = 'ПОРАЖЕНИЕ'; losses++; }
            else { winText = 'НИЧЬЯ'; draws++; }

            const ratingInfo = matchRatings[match.id] || { change: 0, total: 0 };
            const ratingHtml = ratingInfo.change !== 0 
                ? `<div style="font-size:0.85em; font-weight:bold; margin-top:5px; color:${ratingInfo.change > 0 ? 'var(--success-color)' : 'var(--danger-color)'};">Рейтинг: ${ratingInfo.change > 0 ? '+' : ''}${ratingInfo.change} (Итого: ${ratingInfo.total})</div>`
                : '';

            const adminEdit = canEdit() ? `
                <div style="margin-top:15px; padding-top:15px; border-top:1px dashed var(--border-color); display:flex; flex-direction:column; gap:10px;">
                    <label style="font-size:0.75em; color:var(--text-muted); text-transform:uppercase;">Дата матча</label>
                    <input type="date" value="${match.match_date || ''}" onchange="updateMatchData(${match.id}, 'match_date', this.value)" style="background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:6px; border-radius:4px;">
                    <label style="font-size:0.75em; color:var(--text-muted); text-transform:uppercase;">Противник</label>
                    <input type="text" value="${opponent}" onchange="updateMatchData(${match.id}, 'enemy_name', this.value)" style="background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:6px; border-radius:4px;">
                    <label style="font-size:0.75em; color:var(--text-muted); text-transform:uppercase;">Счёт</label>
                    <div style="display:flex; gap:5px;">
                        <input type="number" value="${cScore}" onchange="updateMatchData(${match.id}, 'clan_score', this.value)" style="flex:1; background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:6px; border-radius:4px;">
                        <input type="number" value="${eScore}" onchange="updateMatchData(${match.id}, 'enemy_points', this.value)" style="flex:1; background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:6px; border-radius:4px;">
                    </div>
                    <button class="btn btn-danger" style="padding:5px; font-size:0.8em;" onclick="deleteMatch(${match.id})">Удалить матч</button>
                </div>` : '';

            timeline.innerHTML += `<div class="timeline-item ${isLeft ? 'left' : 'right'}">
                <div class="timeline-content">
                    <div style="font-size:0.8em; color:var(--accent-color); margin-bottom:5px;">ТУРНИР ${tourneyNum} · ЭТАП ${stageNum}</div>
                    <div class="timeline-date">${dateStr}</div>
                    <div class="timeline-opponent">vs <strong>${opponent}</strong></div>
                    <div class="timeline-score ${scoreClass}">${cScore} : ${eScore}</div>
                    <div style="color:var(--text-muted); font-size:0.9em; margin-top:5px;">${winText}</div>
                    ${ratingHtml}
                    ${adminEdit}
                </div>
            </div>`;
        } else {
            const fillBtn = canEdit() ? `<div style="margin-top:15px;"><button class="btn" style="padding:6px 12px; font-size:0.8em;" onclick="fillEmptyMatch(${stageNum})">+ ЗАПОЛНИТЬ</button></div>` : '';
            timeline.innerHTML += `<div class="timeline-item ${isLeft ? 'left' : 'right'}">
                <div class="timeline-content" style="opacity:0.55; border-style:dashed;">
                    <div style="font-size:0.8em; color:var(--text-muted); margin-bottom:5px;">ТУРНИР ${tourneyNum} · ЭТАП ${stageNum}</div>
                    <div class="timeline-opponent" style="color:var(--text-muted); font-style:italic;">Не сыгран</div>
                    ${fillBtn}
                </div>
            </div>`;
        }
    });

    renderHistoryChart(wins, losses, draws);
}

async function fillEmptyMatch(stageNum) {
    if (!canEdit()) return;
    const defaultDate = getLocalDateString();
    const date = prompt(`Дата матча для этапа ${stageNum} (ГГГГ-ММ-ДД):`, defaultDate);
    if (date === null) return;
    const cleanDate = (date || '').trim() || null;

    const { error } = await supabaseClient.from('clan_matches').insert([{
        stage_number: stageNum, match_date: cleanDate,
        clan_score: 0, enemy_points: 0, enemy_name: 'Новый враг',
        season_id: AppState.viewingSeason.id
    }]);
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else { showToast(`Матч создан для этапа ${stageNum}`, 'success'); await refreshMatches(); loadMatchHistory(); }
}

async function addMatchHistory() {
    if (!canEdit()) return;
    const usedStages = new Set(AppState.matches.map(m => m.stage_number).filter(x => x));
    const totalStages = getMaxStage();
    let freeStage = null;
    for (let s = 1; s <= totalStages; s++) { if (!usedStages.has(s)) { freeStage = s; break; } }
    if (!freeStage) { showToast('Все этапы заполнены', 'info'); return; }
    fillEmptyMatch(freeStage);
}

async function updateMatchData(id, field, value) {
    if (!canEdit()) return;
    let val = value;
    if (field === 'clan_score' || field === 'enemy_points') val = parseInt(value) || 0;
    else if (field === 'match_date') { const t = (value || '').trim(); val = t === '' ? null : t; }
    const { error } = await supabaseClient.from('clan_matches').update({ [field]: val }).eq('id', id);
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else { showToast('Данные обновлены', 'success'); await refreshMatches(); loadMatchHistory(); }
}

async function deleteMatch(id) {
    if (!canEdit() || !confirm('Удалить этот матч?')) return;
    const { error } = await supabaseClient.from('clan_matches').delete().eq('id', id);
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else { showToast('Матч удалён', 'success'); await refreshMatches(); loadMatchHistory(); }
}

function renderHistoryChart(wins, losses, draws) {
    const canvas = document.getElementById('matchHistoryChart'); if (!canvas) return;
    if (myChart) myChart.destroy();
    const total = wins + losses + draws;
    const pct = n => total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
    const setTxt = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v; };
    setTxt('hr-wins', wins); setTxt('hr-losses', losses); setTxt('hr-draws', draws); setTxt('hr-total', total);
    setTxt('hr-wins-pct', pct(wins) + '%'); setTxt('hr-losses-pct', pct(losses) + '%'); setTxt('hr-draws-pct', pct(draws) + '%');

    const hasData = total > 0;
    myChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Победы', 'Поражения', 'Ничьи'],
            datasets: [{
                data: hasData ? [wins, losses, draws] : [1, 0, 0],
                backgroundColor: hasData ? ['#4caf50', '#e53935', '#ff9800'] : ['#2a3a2a', '#2a3a2a', '#2a3a2a'],
                borderColor: '#0d0f0d', borderWidth: 2
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#d1d5d1', font: { family: 'Courier New', weight: 'bold' } } },
                tooltip: { enabled: hasData, callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} (${pct(ctx.parsed)}%)` } }
            },
            cutout: '70%'
        }
    });
}

// ==================== КАЛЕНДАРЬ ====================
async function loadCalendar() {
    const container = document.getElementById('calendar-list');
    if (!container) return;
    await refreshUpcoming();
    
    if (AppState.upcomingMatches.length === 0) {
        container.innerHTML = '<div style="text-align:center; padding:40px; color:var(--text-muted); text-transform:uppercase;">Турниров не запланировано</div>';
        return;
    }

    const now = new Date(); 
    const todayStart = new Date(); 
    todayStart.setHours(0, 0, 0, 0);

    const grouped = {};
    AppState.upcomingMatches.forEach(m => {
        const key = m.tournament_number ? `tour_${m.tournament_number}` : `m_${m.id}`;
        if (!grouped[key]) grouped[key] = { tour: m.tournament_number, matches: [], isPast: true };
        grouped[key].matches.push(m);
        
        let matchDateTime;
        if (m.match_time) {
            matchDateTime = new Date(`${m.match_date}T${m.match_time}`);
        } else {
            matchDateTime = new Date(`${m.match_date}T23:59:59`);
        }
        
        if (matchDateTime >= now) {
            grouped[key].isPast = false;
        }
    });

    const upcoming = Object.values(grouped).filter(g => !g.isPast);
    const past = Object.values(grouped).filter(g => g.isPast);

    const renderGroup = (g, isPast = false) => {
        g.matches.sort((a, b) => new Date(a.match_date) - new Date(b.match_date));
        
        let html = `<div class="calendar-card" style="display:flex; flex-direction:column; justify-content:space-between; opacity:${isPast ? 0.5 : 1};">`;
        html += `<div>`;
        
        if (g.tour) {
            html += `<div style="color:var(--accent-color); font-weight:bold; font-size:1.2em; margin-bottom:10px; border-bottom: 2px solid var(--border-color); padding-bottom: 5px;">🏆 ТУРНИР ${g.tour}</div>`;
        } else {
            html += `<div style="color:var(--accent-color); font-weight:bold; font-size:1.2em; margin-bottom:10px; border-bottom: 2px solid var(--border-color); padding-bottom: 5px;">🏆 ТУРНИР (вне сезона)</div>`;
        }

        g.matches.forEach(m => {
            const d = new Date(m.match_date + 'T00:00:00');
            const daysUntil = Math.round((d - todayStart) / (1000 * 60 * 60 * 24));
            
            let badge = '';
            if (!isPast && daysUntil === 0) badge = ' <span style="color:var(--danger-color); font-weight:bold;">СЕГОДНЯ</span>';
            else if (!isPast && daysUntil === 1) badge = ' <span style="color:var(--accent-color);">ЗАВТРА</span>';
            
            const dateStr = d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long', weekday: 'short' });
            const timeStr = m.match_time ? ` · ${m.match_time}` : '';
            const stageLabel = m.stage_number ? `Этап ${m.stage_number}: ` : '';

            html += `
                <div style="padding: 8px 0; border-bottom: 1px dashed var(--border-color);">
                    <div style="font-weight: bold; color: var(--text-color);">${stageLabel}<span style="color:var(--accent-color);">${dateStr}${timeStr}</span>${badge}</div>
                    ${m.notes ? `<div style="font-size:0.85em; color:var(--text-muted); margin-top:2px;">${m.notes}</div>` : ''}
                </div>
            `;
        });

        html += `</div>`;

        if (canEdit()) {
            html += `<div style="display:flex; gap:5px; margin-top:10px; flex-wrap:wrap;">`;
            g.matches.forEach(m => {
                html += `<button class="btn btn-danger" style="padding:3px 8px; font-size:0.75em;" onclick="deleteUpcoming(${m.id})">Удалить ${m.stage_number ? 'Э' + m.stage_number : ''}</button>`;
            });
            html += `</div>`;
        }
        html += `</div>`;
        return html;
    };

    let finalHtml = '';
    if (upcoming.length > 0) {
        finalHtml += '<h3 style="color:var(--accent-color); text-transform:uppercase; margin-bottom:15px;">Ближайшие турниры</h3>';
        finalHtml += `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:15px; margin-bottom:30px;">${upcoming.map(g => renderGroup(g, false)).join('')}</div>`;
    }
    if (past.length > 0) {
        finalHtml += '<h3 style="color:var(--text-muted); text-transform:uppercase; margin-bottom:15px;">Прошедшие</h3>';
        finalHtml += `<div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(320px, 1fr)); gap:15px;">${past.slice(-5).reverse().map(g => renderGroup(g, true)).join('')}</div>`;
    }
    container.innerHTML = finalHtml;
}

async function addUpcomingMatch() {
    if (!canEdit()) return;
    const date = document.getElementById('cal-date').value;
    const time = document.getElementById('cal-time').value;
    const notes = document.getElementById('cal-notes').value.trim();
    const tourNum = document.getElementById('cal-tournament').value;
    const stageNum = document.getElementById('cal-stage').value;

    if (!date) return showToast('Укажите дату', 'error');

    if (tourNum && !stageNum) {
        for (let i = 0; i < 3; i++) {
            const globalStage = (parseInt(tourNum) - 1) * 3 + i + 1;
            await supabaseClient.from('upcoming_matches').insert([{
                match_date: date, 
                match_time: time || null,
                match_type: 'tournament', 
                notes: notes || null,
                tournament_number: parseInt(tourNum),
                stage_number: globalStage,
                season_id: AppState.viewingSeason.id
            }]);
        }
        showToast(`Турнир ${tourNum} добавлен (3 этапа на ${date})`, 'success');
    } else {
        const { error } = await supabaseClient.from('upcoming_matches').insert([{
            match_date: date, match_time: time || null,
            match_type: 'tournament', notes: notes || null,
            tournament_number: tourNum ? parseInt(tourNum) : null,
            stage_number: stageNum ? parseInt(stageNum) : null,
            season_id: AppState.viewingSeason.id
        }]);
        if (error) { showToast('Ошибка: ' + error.message, 'error'); return; }
        showToast('Матч добавлен', 'success');
    }
    
    document.getElementById('cal-notes').value = '';
    await refreshUpcoming();
    loadCalendar();
}

async function deleteUpcoming(id) {
    if (!canEdit() || !confirm('Удалить запись из календаря?')) return;
    await supabaseClient.from('upcoming_matches').delete().eq('id', id);
    await refreshUpcoming();
    loadCalendar();
    showToast('Удалено', 'success');
}

// ==================== ШТРАФЫ ====================
async function loadFines() {
    const tb = document.getElementById('fines-table-body'); if (!tb) return;
    await refreshFines();
    tb.innerHTML = AppState.fines.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Нет штрафов</td></tr>' : '';
    AppState.fines.forEach(f => {
        const player = AppState.players.find(p => p.id === f.player_id);
        const canToggle = canEdit();
        tb.innerHTML += `<tr>
            <td><strong>${player ? player.nickname : 'Неизвестный'}</strong></td>
            <td>${f.reason}</td>
            <td style="color:var(--danger-color);">${f.amount} ₽</td>
            <td class="${f.status === 'open' ? 'status-open' : 'status-closed'}">${f.status === 'open' ? 'Открыт' : 'Закрыт'}</td>
            <td>${canToggle ? `<button class="btn" onclick="toggleFineStatus(${f.id}, '${f.status}')">${f.status === 'open' ? 'Закрыть' : 'Открыть'}</button><button class="btn btn-danger" onclick="deleteFine(${f.id})">X</button>` : '—'}</td>
        </tr>`;
    });
}

async function addFine() {
    if (!canEdit()) return;
    const pid = document.getElementById('fine-player').value, r = document.getElementById('fine-reason').value.trim(), a = parseInt(document.getElementById('fine-amount').value) || 0;
    if (!pid || !r) return showToast('Выберите игрока и укажите причину', 'error');
    const { error } = await supabaseClient.from('fines').insert([{ player_id: pid, reason: r, amount: a, status: 'open' }]);
    if (error) showToast('Ошибка: ' + error.message, 'error'); 
    else { showToast('Штраф добавлен', 'success'); document.getElementById('fine-reason').value = ''; document.getElementById('fine-amount').value = ''; loadFines(); }
}

async function toggleFineStatus(id, st) {
    if (!canEdit()) return;
    await supabaseClient.from('fines').update({ status: st === 'open' ? 'closed' : 'open' }).eq('id', id);
    loadFines();
}
async function deleteFine(id) {
    if (!canEdit()) return;
    if (confirm('Удалить штраф?')) { await supabaseClient.from('fines').delete().eq('id', id); loadFines(); }
}

// ==================== ЗАГРУЗКА ФОТО (МАССОВАЯ) ====================
function openPhotoModal(input) {
    const files = input.files; 
    if (!files || files.length === 0) return;
    
    currentPhotoFiles = Array.from(files);
    document.getElementById('photo-modal').style.display = 'flex';
    
    const previewContainer = document.getElementById('photo-preview');
    previewContainer.innerHTML = '';
    
    if (currentPhotoFiles.length === 1) {
        const r = new FileReader(); 
        r.onload = (e) => { 
            previewContainer.innerHTML = `<img id="preview-img" src="${e.target.result}" style="max-width: 100%; max-height: 150px; border-radius: var(--radius); border: 1px solid var(--border-color);">`;
            previewContainer.style.display = 'block'; 
        };
        r.readAsDataURL(currentPhotoFiles[0]);
        
        // Сброс селекта этапа (показываем как обычно)
        document.getElementById('modal-stage-label').innerText = 'Этап';
        document.getElementById('modal-stage').style.display = 'block';
        document.getElementById('multi-stage-hint').style.display = 'none';
    } else {
        // Несколько файлов
        let listHtml = '<ul style="text-align:left; color:var(--text-muted); font-size:0.9em; padding-left:20px; margin:0;">';
        currentPhotoFiles.forEach((f, i) => {
            listHtml += `<li>${f.name}</li>`;
        });
        listHtml += '</ul>';
        previewContainer.innerHTML = `
            <div style="background:var(--input-bg); padding:10px; border-radius:var(--radius); border:1px solid var(--border-color);">
                <div style="color:var(--success-color); font-weight:bold; margin-bottom:5px;">Выбрано файлов: ${currentPhotoFiles.length}</div>
                ${listHtml}
            </div>
        `;
        previewContainer.style.display = 'block';

        // Меняем лейбл этапа
        document.getElementById('modal-stage-label').innerText = 'Начальный этап';
        document.getElementById('multi-stage-hint').style.display = 'block';
    }
}

function closePhotoModal() {
    document.getElementById('photo-modal').style.display = 'none';
    document.getElementById('attendance-photo').value = '';
    document.getElementById('photo-preview').style.display = 'none';
    document.getElementById('photo-preview').innerHTML = '';
    currentPhotoFiles = [];
}

async function saveAbsentStatuses() {
    if (!canEdit()) return;
    const btn = document.getElementById('save-absent-btn');
    btn.disabled = true; btn.innerText = '...';
    const sid = AppState.viewingSeason.id;

    for (const p of pendingAbsentPlayers) {
        const sel = document.getElementById(`absent-status-${p.id}`);
        const status = sel ? sel.value : 'Не пришел';
        await supabaseClient.from('attendance').upsert({ player_id: p.id, tournament_number: currentAbsentStage, status, season_id: sid }, { onConflict: 'season_id, player_id, tournament_number' });
    }

    document.getElementById('absent-modal').style.display = 'none';
    document.getElementById('photo-status').innerHTML = `СТАТУСЫ ОБНОВЛЕНЫ.`;
    await refreshAll();
    btn.disabled = false; btn.innerText = 'ПОДТВЕРДИТЬ';
    showToast('Статусы сохранены!', 'success');
}

async function confirmPhotoUpload() {
    if (currentPhotoFiles.length === 0 || !canEdit()) return;
    
    const startStage = parseInt(document.getElementById('modal-stage').value);
    const statusDiv = document.getElementById('photo-status');
    const sid = AppState.viewingSeason.id;
    document.getElementById('photo-modal').style.display = 'none';
    
    const compressImage = (file) => new Promise((resolve) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image(); img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas'); const MAX_WIDTH = 1200;
                const scale = MAX_WIDTH / img.width; canvas.width = MAX_WIDTH; canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', 0.7).split(',')[1]);
            };
        };
    });

    const normalizeStr = (str) => {
        if (!str) return '';
        return str.toLowerCase().replace(/[\s\-_.,'"]/g, '').replace(/[а]/g, 'a').replace(/[е]/g, 'e').replace(/[о]/g, 'o').replace(/[р]/g, 'p').replace(/[с]/g, 'c').replace(/[у]/g, 'y').replace(/[х]/g, 'x').replace(/[к]/g, 'k').replace(/[м]/g, 'm').replace(/[т]/g, 't').replace(/[в]/g, 'b').replace(/[н]/g, 'h');
    };

    const levenshtein = (a, b) => {
        if (a.length === 0) return b.length; if (b.length === 0) return a.length;
        const matrix = [];
        for (let i = 0; i <= b.length; i++) matrix[i] = [i];
        for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) matrix[i][j] = matrix[i - 1][j - 1];
                else matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
            }
        }
        return matrix[b.length][a.length];
    };

    const findPlayerSmart = (aiNickname) => {
        if (!aiNickname) return null;
        const aiClean = normalizeStr(aiNickname);
        let found = AppState.activePlayers.find(p => normalizeStr(p.nickname) === aiClean);
        if (found) return found;
        let bestMatch = null, bestDistance = Infinity;
        AppState.activePlayers.forEach(p => {
            const dbClean = normalizeStr(p.nickname);
            if ((dbClean.includes(aiClean) || aiClean.includes(dbClean)) && Math.abs(dbClean.length - aiClean.length) <= 3) { bestMatch = p; bestDistance = 0; return; }
            const distance = levenshtein(dbClean, aiClean);
            const maxAllowedDist = aiClean.length > 6 ? 2 : 1;
            if (distance <= maxAllowedDist && distance < bestDistance) { bestDistance = distance; bestMatch = p; }
        });
        return bestMatch;
    };

    let totalAdded = 0;
    let allNotFound = [];
    let globalPresentIds = new Set();
    let lastProcessedStage = startStage;

    try {
        for (let i = 0; i < currentPhotoFiles.length; i++) {
            const file = currentPhotoFiles[i];
            const stageNum = startStage + i;
            lastProcessedStage = stageNum;

            statusDiv.innerHTML = `ОБРАБОТКА ФАЙЛА ${i + 1} ИЗ ${currentPhotoFiles.length} (Этап ${stageNum})...`;

            const base64 = await compressImage(file);
            const res = await fetch('https://rpqiapddvlkdecddczqx.supabase.co/functions/v1/recognize', {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` },
                body: JSON.stringify({ image: base64 })
            });
            
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            const result = await res.json();
            
            if (result.players && result.players.length > 0) {
                let added = 0, notFound = [], presentIds = new Set();
                for (const p of result.players) {
                    const pl = findPlayerSmart(p.nickname);
                    if (pl) {
                        presentIds.add(pl.id);
                        globalPresentIds.add(pl.id);
                        await supabaseClient.from('attendance').upsert({ player_id: pl.id, tournament_number: stageNum, status: 'Пришел', season_id: sid }, { onConflict: 'season_id, player_id, tournament_number' });
                        await supabaseClient.from('match_stats').upsert({ player_id: pl.id, stage_number: stageNum, season_id: sid, kills: p.kills || 0, deaths: p.deaths || 0, assists: p.assists || 0, points: p.points || 0 }, { onConflict: 'season_id, player_id, stage_number' });
                        await recalculatePlayerStats(pl.id);
                        added++;
                    } else { notFound.push(p.nickname); }
                }

                if (result.clan_score !== undefined && result.enemy_score !== undefined && result.clan_score > 0) {
                    await supabaseClient.from('clan_matches').upsert({
                        stage_number: stageNum, match_date: getLocalDateString(),
                        clan_score: result.clan_score, enemy_points: result.enemy_score,
                        enemy_name: result.enemy_name || 'Неизвестный враг', season_id: sid
                    }, { onConflict: 'season_id, stage_number' });
                }

                totalAdded += added;
                allNotFound.push(...notFound);
            }
        }

        // После обработки всех файлов, ищем отсутствующих
        pendingAbsentPlayers = [];
        AppState.activePlayers.forEach(pl => { if (!globalPresentIds.has(pl.id)) pendingAbsentPlayers.push(pl); });

        statusDiv.innerHTML = `УСПЕШНО ПРИШЛО: ${totalAdded}.`;
        if (allNotFound.length > 0) statusDiv.innerHTML += `<br>НЕ НАЙДЕНЫ: ${[...new Set(allNotFound)].join(', ')}`;

        if (pendingAbsentPlayers.length > 0) {
            currentAbsentStage = startStage; // Записываем отгулы/прогулы на первый этап (или можно на последний)
            const listContainer = document.getElementById('absent-players-list'); listContainer.innerHTML = '';
            pendingAbsentPlayers.forEach(p => {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border-color); margin-bottom:5px;';
                row.innerHTML = `<span style="font-weight:bold;">${p.nickname}</span><select id="absent-status-${p.id}" style="padding:5px; border-radius:var(--radius); background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color);"><option value="Не пришел">Не пришел</option><option value="Отгул">Отгул</option></select>`;
                listContainer.appendChild(row);
            });
            document.getElementById('absent-modal').style.display = 'flex';
            statusDiv.innerHTML += `<br>ПОДТВЕРДИТЕ СТАТУСЫ (${pendingAbsentPlayers.length})`;
        } else {
            await refreshAll();
            showToast(`Распознано ${totalAdded} игроков!`, 'success');
        }

    } catch (err) { 
        console.error(err); 
        statusDiv.innerHTML = `ОШИБКА: ${err.message}`; 
        showToast('Ошибка нейросети', 'error'); 
    }
    closePhotoModal(); document.getElementById('attendance-photo').value = '';
}

// ==================== АНАЛИТИКА ====================
async function loadAnalytics() {
    const active = AppState.activePlayers;
    const topKD = [...active].sort((a, b) => b.kd - a.kd).slice(0, 10);
    document.querySelector('#top-kd-table tbody').innerHTML = topKD.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.kd}</td></tr>`).join('');
    const topKDA = [...active].sort((a, b) => b.kda - a.kda).slice(0, 10);
    document.querySelector('#top-kda-table tbody').innerHTML = topKDA.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.kda}</td></tr>`).join('');
    const topP = [...active].sort((a, b) => b.points - a.points).slice(0, 10);
    document.querySelector('#top-points-table tbody').innerHTML = topP.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.points}</td></tr>`).join('');
    
    document.getElementById('stat-total-players').innerText = active.length;
    const inS = active.filter(p => p.squad && p.squad.trim() !== '').length;
    document.getElementById('stat-in-squads').innerText = inS;
    document.getElementById('stat-free').innerText = active.length - inS;

    if (active.length > 0) {
        const sumKd = active.reduce((a, p) => a + (p.kd || 0), 0);
        const sumKda = active.reduce((a, p) => a + (p.kda || 0), 0);
        const sumPts = active.reduce((a, p) => a + (p.points || 0), 0);
        document.getElementById('avg-kd-total').innerText = (sumKd / active.length).toFixed(2);
        document.getElementById('avg-kda-total').innerText = (sumKda / active.length).toFixed(2);
        document.getElementById('avg-points-total').innerText = Math.round(sumPts / active.length);

        if (AppState.matchStats.length > 0) {
            let tK = 0, tD = 0, tA = 0, tP = 0;
            AppState.matchStats.forEach(s => { tK += s.kills || 0; tD += s.deaths || 0; tA += s.assists || 0; tP += s.points || 0; });
            const kdSt = tD === 0 ? tK : tK / tD;
            const kdaSt = tD === 0 ? (tK + tA) : (tK + tA) / tD;
            const stCount = Math.max(...AppState.matchStats.map(s => s.stage_number));
            document.getElementById('avg-kd-stage').innerText = kdSt.toFixed(2);
            document.getElementById('avg-kda-stage').innerText = kdaSt.toFixed(2);
            document.getElementById('avg-points-stage').innerText = Math.round(tP / stCount);
        }
    }
}

const ANALYTICS_CHANNEL_ID = '1567231595797028874';
const ROSTER_CHANNEL_ID = '1567230953833627668';

async function sendAnalyticsScreenshot() {
    const active = AppState.activePlayers;
    if (!active) return showToast('Нет данных', 'error');
    const topKD = [...active].sort((a, b) => b.kd - a.kd).slice(0, 10);
    const topKDA = [...active].sort((a, b) => b.kda - a.kda).slice(0, 10);
    const topP = [...active].sort((a, b) => b.points - a.points).slice(0, 10);

    const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
    canvas.width = 1200; canvas.height = 680;
    ctx.fillStyle = '#0d0f0d'; ctx.fillRect(0, 0, canvas.width, canvas.height);

    function drawTable(title, data, x, y, width, colTitle, fieldKey) {
        ctx.fillStyle = '#1a201a'; ctx.beginPath(); ctx.roundRect(x, y, width, 375, 8); ctx.fill(); ctx.strokeStyle = '#2a3a2a'; ctx.stroke();
        ctx.fillStyle = '#ff9800'; ctx.font = 'bold 20px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(title, x + width / 2, y + 35);
        ctx.fillStyle = '#7a857a'; ctx.font = 'bold 14px Segoe UI'; ctx.textAlign = 'left'; ctx.fillText('#', x + 25, y + 75); ctx.fillText('Боец', x + 70, y + 75);
        ctx.textAlign = 'right'; ctx.fillText(colTitle, x + width - 25, y + 75);
        ctx.beginPath(); ctx.moveTo(x + 25, y + 90); ctx.lineTo(x + width - 25, y + 90); ctx.strokeStyle = '#2a3a2a'; ctx.stroke();
        ctx.font = '14px Segoe UI';
        data.forEach((p, i) => {
            const rowY = y + 115 + i * 25;
            ctx.fillStyle = '#ff9800'; ctx.textAlign = 'left'; ctx.fillText(i + 1, x + 25, rowY);
            ctx.fillStyle = '#d1d5d1'; ctx.fillText(p.nickname, x + 70, rowY);
            ctx.textAlign = 'right'; ctx.fillText(p[fieldKey] !== undefined ? p[fieldKey] : 0, x + width - 25, rowY);
            if (i < data.length - 1) { ctx.beginPath(); ctx.moveTo(x + 25, rowY + 10); ctx.lineTo(x + width - 25, rowY + 10); ctx.strokeStyle = '#2a3a2a'; ctx.stroke(); }
        });
    }
    drawTable('ТОП КД', topKD, 20, 20, 380, 'КД', 'kd');
    drawTable('ТОП КДА', topKDA, 410, 20, 380, 'КДА', 'kda');
    drawTable('ТОП ОЧКИ', topP, 800, 20, 380, 'Очки', 'points');

    const sumKd = active.reduce((a, p) => a + (p.kd || 0), 0);
    const sumKda = active.reduce((a, p) => a + (p.kda || 0), 0);
    const sumPts = active.reduce((a, p) => a + (p.points || 0), 0);
    const avgKdTotal = (sumKd / active.length || 0).toFixed(2);
    const avgKdaTotal = (sumKda / active.length || 0).toFixed(2);
    const avgPtsTotal = Math.round(sumPts / active.length) || 0;

    let avgKdStage = '0.00', avgKdaStage = '0.00', avgPtsStage = '0';
    if (AppState.matchStats.length > 0) {
        let tK = 0, tD = 0, tA = 0, tP = 0;
        AppState.matchStats.forEach(s => { tK += s.kills || 0; tD += s.deaths || 0; tA += s.assists || 0; tP += s.points || 0; });
        const kdSt = tD === 0 ? tK : tK / tD;
        const kdaSt = tD === 0 ? (tK + tA) : (tK + tA) / tD;
        const stCount = Math.max(...AppState.matchStats.map(s => s.stage_number));
        avgKdStage = kdSt.toFixed(2); avgKdaStage = kdaSt.toFixed(2); avgPtsStage = Math.round(tP / stCount).toString();
    }

    const statsY = 420;
    ctx.fillStyle = '#ff9800'; ctx.font = 'bold 20px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('СРЕДНИЕ ПОКАЗАТЕЛИ', 600, statsY);
    const blockW = 380, blockH = 70, row1Y = statsY + 20, row2Y = row1Y + blockH + 15;
    const drawBlocks = (blocks, yPos) => {
        blocks.forEach(b => {
            ctx.fillStyle = '#1a201a'; ctx.beginPath(); ctx.roundRect(b.x, yPos, blockW, blockH, 8); ctx.fill(); ctx.strokeStyle = '#2a3a2a'; ctx.stroke();
            ctx.fillStyle = '#7a857a'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(b.title, b.x + blockW / 2, yPos + 25);
            ctx.fillStyle = '#4caf50'; ctx.font = 'bold 22px Segoe UI'; ctx.fillText(b.value, b.x + blockW / 2, yPos + 55);
        });
    };
    drawBlocks([{ title: 'КД (за этап)', value: avgKdStage, x: 20 }, { title: 'КДА (за этап)', value: avgKdaStage, x: 410 }, { title: 'Очки (за этап)', value: avgPtsStage, x: 800 }], row1Y);
    drawBlocks([{ title: 'Общий КД', value: avgKdTotal, x: 20 }, { title: 'Общий КДА', value: avgKdaTotal, x: 410 }, { title: 'Общие очки', value: avgPtsTotal, x: 800 }], row2Y);

    const base64Image = canvas.toDataURL('image/png');
    try {
        const res = await fetch('https://rpqiapddvlkdecddczqx.supabase.co/functions/v1/send-to-discord', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId: ANALYTICS_CHANNEL_ID, content: '', imageBase64: base64Image, deletePrevious: true })
        });
        if (res.ok) showToast('Аналитика отправлена!', 'success'); else showToast('Ошибка', 'error');
    } catch (err) { console.error(err); showToast('Ошибка отправки', 'error'); }
}

async function sendRosterScreenshot() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 1200; canvas.height = 900;
    ctx.fillStyle = '#0d0f0d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff9800'; ctx.font = 'bold 28px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText('СОСТАВ КЛАНА', 600, 50);
    const cardW = 360, cardH = 350, gapX = 30, gapY = 40;
    const startX = (1200 - (cardW * 3 + gapX * 2)) / 2, startY = 100;
    SQUADS_CONFIG.forEach((squad, index) => {
        const col = index % 3, row = Math.floor(index / 3);
        const x = startX + col * (cardW + gapX), y = startY + row * (cardH + gapY);
        ctx.fillStyle = '#1a201a'; ctx.beginPath(); ctx.roundRect(x, y, cardW, cardH, 8); ctx.fill(); ctx.strokeStyle = '#2a3a2a'; ctx.stroke();
        ctx.fillStyle = '#4caf50'; ctx.font = 'bold 18px Segoe UI'; ctx.textAlign = 'center'; ctx.fillText(squad.name, x + cardW / 2, y + 35);
        ctx.beginPath(); ctx.moveTo(x + 20, y + 50); ctx.lineTo(x + cardW - 20, y + 50); ctx.strokeStyle = '#4caf50'; ctx.stroke();
        squad.roles.forEach((role, rIndex) => {
            const slotY = y + 70 + rIndex * 45;
            const player = AppState.activePlayers.find(p => p.squad === squad.name && p.role === role);
            const playerName = player ? player.nickname : 'Свободно';
            const playerColor = player ? '#d1d5d1' : '#555';
            const displayRole = role.replace(' 1', '').replace(' 2', '').replace(' 3', '');
            ctx.fillStyle = '#111411'; ctx.beginPath(); ctx.roundRect(x + 20, slotY, cardW - 40, 32, 4); ctx.fill(); ctx.strokeStyle = '#2a3a2a'; ctx.stroke();
            ctx.fillStyle = '#7a857a'; ctx.font = '14px Segoe UI'; ctx.textAlign = 'left'; ctx.fillText(displayRole, x + 30, slotY + 21, 120);
            ctx.fillStyle = playerColor; ctx.textAlign = 'right'; ctx.fillText(playerName, x + cardW - 30, slotY + 21, 180);
        });
    });
    const base64Image = canvas.toDataURL('image/png');
    try {
        const res = await fetch('https://rpqiapddvlkdecddczqx.supabase.co/functions/v1/send-to-discord', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ channelId: ROSTER_CHANNEL_ID, content: '', imageBase64: base64Image, deletePrevious: true })
        });
        if (res.ok) showToast('Состав отправлен!', 'success'); else showToast('Ошибка', 'error');
    } catch (err) { console.error(err); showToast('Ошибка отправки', 'error'); }
}

async function clearAllData() {
    if (!canEdit()) { showToast('Только в активном сезоне', 'error'); return; }
    if (!confirm(`⚠️ Удалить ВСЕ данные Сезона ${AppState.activeSeason.season_number}? Игроки и штрафы останутся.`)) return;
    const sid = AppState.activeSeason.id;
    const statusDiv = document.getElementById('photo-status');
    if (statusDiv) statusDiv.innerHTML = 'УДАЛЕНИЕ...';
    try {
        await supabaseClient.from('match_stats').delete().eq('season_id', sid);
        await supabaseClient.from('attendance').delete().eq('season_id', sid);
        await supabaseClient.from('clan_matches').delete().eq('season_id', sid);
        await supabaseClient.from('upcoming_matches').delete().eq('season_id', sid);
        await supabaseClient.from('tournaments').delete().eq('season_id', sid);
        await supabaseClient.from('players').update({ kd: 0, kda: 0, points: 0 }).neq('id', 0);
        await supabaseClient.from('tournaments').insert([{ tournament_number: 1, season_id: sid }]);
        if (statusDiv) statusDiv.innerHTML = 'ОЧИЩЕНО!';
        await refreshAll();
        showToast('Данные сезона очищены', 'success');
    } catch (err) { showToast('Ошибка: ' + err.message, 'error'); }
}

// ==================== REALTIME ПОДПИСКА ====================
let realtimeChannel = null;
function initRealtime() {
    if (realtimeChannel) supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = supabaseClient
        .channel('portal-realtime-sync')
        .on('postgres_changes', { event: '*', schema: 'public' }, (payload) => {
            console.log('Realtime изменение:', payload);
            refreshAll();
        })
        .subscribe((status) => {
            if (status === 'SUBSCRIBED') console.log('✅ Realtime подключён');
        });
}

// ==================== СТАРТ ====================
refreshAll().then(() => {
    initRealtime();
});
