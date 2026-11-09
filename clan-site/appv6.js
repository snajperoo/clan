const SUPABASE_URL = 'https://rpqiapddvlkdecddczqx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hDt4D6V24JeooGxNoLN4rQ__YFppVSz'; 
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

let allPlayers = [], activePlayers = [], allFines = [], allAttendance = [], allNotes = [];
let currentEditId = null, maxAttendanceStage = 3, maxTournament = 4, isAdmin = false, currentPhotoFile = null;
let pendingAbsentPlayers = [], currentAbsentStage = null, currentSortColumn = 'kd', currentSortDirection = 'desc';

// Сезоны
let currentSeason = 'all';
const TOURNAMENTS_PER_SEASON = 12;

let myChart = null;

const ADMIN_SECRET_CODE = 'ADMIN123';
const STATUS_PRIORITY = { 'в обработке': 1, 'в клане': 2, 'кикнут': 3 };

const SQUADS_CONFIG = [
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
        document.getElementById('my-profile-tab').style.display = 'inline-block'; loadAllData();
        document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'flex'); 
        showToast('Вы вошли как Администратор', 'info');
    } else {
        const player = allPlayers.find(p => p.discord_id && p.discord_id.toString().trim() === input);
        if (player) {
            document.getElementById('login-modal').style.display = 'none';
            document.getElementById('logout-btn').style.display = 'inline-block';
            document.getElementById('my-profile-tab').style.display = 'inline-block';
            loadAllData().then(() => loadMyProfile(player));
            showToast('Успешный вход', 'success');
        } else { document.getElementById('login-error').innerText = 'Игрок с таким Discord ID не найден.'; }
    }
}

function logout() { location.reload(); }

// ФУНКЦИЯ ПЕРЕКЛЮЧЕНИЯ СЕЗОНОВ
function switchViewingSeason(val) {
    currentSeason = val;
    showToast(`Выбран сезон: ${val === 'all' ? 'Все время' : val}`, 'info');
    
    // Обновляем данные на активных вкладках
    if (document.getElementById('tab-history').classList.contains('active')) loadMatchHistory();
    if (document.getElementById('tab-calendar').classList.contains('active')) loadCalendar();
    if (document.getElementById('tab-analytics').classList.contains('active')) loadAnalytics();
    if (document.getElementById('tab-stats').classList.contains('active')) loadMatchStats();
}

function filterBySeason(tournamentNum) {
    if (currentSeason === 'all') return true;
    const seasonInt = parseInt(currentSeason);
    const minT = (seasonInt - 1) * TOURNAMENTS_PER_SEASON + 1;
    const maxT = seasonInt * TOURNAMENTS_PER_SEASON;
    return tournamentNum >= minT && tournamentNum <= maxT;
}

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
    if (!isAdmin) { showToast('Доступно только администраторам', 'error'); return; }
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

async function loadAllData() {
    populateProfileDropdowns();
    
    const { data: players } = await supabaseClient.from('players').select('*').order('kd', { ascending: false });
    if (players) { allPlayers = players; activePlayers = players.filter(p => !p.status || p.status === 'в клане'); renderTops(); renderPlayerList(); fillPlayerSelects(); }
    
    const { data: notesData } = await supabaseClient.from('player_notes').select('*');
    if (notesData) allNotes = notesData;

    const { data: rifles } = await supabaseClient.from('assault_rifles').select('name').order('name');
    const selectRifle = document.getElementById('select-rifle');
    if (selectRifle) {
        selectRifle.innerHTML = '<option value="">-- Выберите --</option>';
        if (rifles) rifles.forEach(i => { const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; selectRifle.appendChild(o); });
        const v = document.createElement('option'); v.value = "Ветеранское"; v.textContent = "Ветеранское"; v.style.color = "var(--accent-color)"; selectRifle.appendChild(v);
    }
    
    const { data: smgs } = await supabaseClient.from('smgs').select('name').order('name');
    const selectSmg = document.getElementById('select-smg');
    if (selectSmg) {
        selectSmg.innerHTML = '<option value="">-- Выберите --</option>';
        if (smgs) smgs.forEach(i => { const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; selectSmg.appendChild(o); });
        const v = document.createElement('option'); v.value = "Ветеранское"; v.textContent = "Ветеранское"; v.style.color = "var(--accent-color)"; selectSmg.appendChild(v);
    }
    
    const { data: pistols } = await supabaseClient.from('pistols').select('name').order('name');
    const selectPistol = document.getElementById('select-pistol');
    if (selectPistol) {
        selectPistol.innerHTML = '<option value="">-- Выберите --</option>';
        if (pistols) pistols.forEach(i => { const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; selectPistol.appendChild(o); });
        const v = document.createElement('option'); v.value = "Ветеранское"; v.textContent = "Ветеранское"; v.style.color = "var(--accent-color)"; selectPistol.appendChild(v);
    }
    
    const { data: snipers } = await supabaseClient.from('snipers').select('name').order('name');
    const selectSniper = document.getElementById('select-sniper');
    if (selectSniper) {
        selectSniper.innerHTML = '<option value="">-- Выберите --</option>';
        if (snipers) snipers.forEach(i => { const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; selectSniper.appendChild(o); });
        const v = document.createElement('option'); v.value = "Ветеранское"; v.textContent = "Ветеранское"; v.style.color = "var(--accent-color)"; selectSniper.appendChild(v);
    }

    const { data: mgs } = await supabaseClient.from('machine_guns').select('name').order('name');
    const selectMG = document.getElementById('select-machine-gun');
    if (selectMG) {
        selectMG.innerHTML = '<option value="">-- Выберите --</option>';
        if (mgs) mgs.forEach(i => { const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; selectMG.appendChild(o); });
        const v = document.createElement('option'); v.value = "Ветеранское"; v.textContent = "Ветеранское"; v.style.color = "var(--accent-color)"; selectMG.appendChild(v);
    }

    const { data: shotguns } = await supabaseClient.from('shotguns').select('name').order('name');
    const selectShotgun = document.getElementById('select-shotgun');
    if (selectShotgun) {
        selectShotgun.innerHTML = '<option value="">-- Выберите --</option>';
        if (shotguns) shotguns.forEach(i => { const o = document.createElement('option'); o.value = i.name; o.textContent = i.name; selectShotgun.appendChild(o); });
        const v = document.createElement('option'); v.value = "Ветеранское"; v.textContent = "Ветеранское"; v.style.color = "var(--accent-color)"; selectShotgun.appendChild(v);
    }
    
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

    initSearchableSelect('select-rifle');
    initSearchableSelect('select-smg');
    initSearchableSelect('select-sniper');
    initSearchableSelect('select-pistol');
    initSearchableSelect('select-machine-gun');
    initSearchableSelect('select-shotgun');
    initSearchableSelect('select-armor-combat');
    initSearchableSelect('select-armor-combined');
    initSearchableSelect('profile-squad');
    initSearchableSelect('profile-role');
    initSearchableSelect('profile-status');
    initSearchableSelect('fine-player');
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

    let sortedPlayers = [...activePlayers].sort((a, b) => {
        let valA = a[currentSortColumn], valB = b[currentSortColumn];
        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';
        if (typeof valA === 'string' && typeof valB === 'string') { return currentSortDirection === 'asc' ? valA.localeCompare(valB) : valB.localeCompare(valA); } 
        else { return currentSortDirection === 'asc' ? (parseFloat(valA) || 0) - (parseFloat(valB) || 0) : (parseFloat(valB) || 0) - (parseFloat(valA) || 0); }
    });

    tbody.innerHTML = sortedPlayers.length === 0 ? '<tr><td colspan="6" style="text-align:center;">Нет данных</td></tr>' : '';
    sortedPlayers.forEach((p, i) => {
        tbody.innerHTML += `<tr><td>#${i+1}</td><td><strong>${p.nickname}</strong></td><td>${p.discord_id || '-'}</td><td>${p.kd}</td><td>${p.kda}</td><td style="color:var(--accent-color);font-weight:bold;">${p.points}</td></tr>`; 
    });
}

function sortTops(column) {
    if (currentSortColumn === column) { currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc'; } 
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
    const container = document.getElementById('player-list-container'); if (!container) return;
    container.innerHTML = '';
    const searchLower = filterText.toLowerCase().trim();
    let filteredPlayers = allPlayers.filter(p => (p.nickname && p.nickname.toLowerCase().includes(searchLower)) || (p.discord_id && p.discord_id.toString().toLowerCase().includes(searchLower)));
    filteredPlayers.sort((a, b) => {
        const sA = a.status ? a.status.toLowerCase() : 'в клане', sB = b.status ? b.status.toLowerCase() : 'в клане';
        return (STATUS_PRIORITY[sA] || 2) !== (STATUS_PRIORITY[sB] || 2) ? (STATUS_PRIORITY[sA] || 2) - (STATUS_PRIORITY[sB] || 2) : a.nickname.localeCompare(b.nickname); 
    });
    if (filteredPlayers.length === 0) { container.innerHTML = '<div style="text-align:center; color:#888; padding: 20px;">Никого не найдено</div>'; return; }
    
    filteredPlayers.forEach(p => {
        const div = document.createElement('div'); div.className = `player-item ${currentEditId === p.id ? 'active' : ''}`;
        let sColor = 'var(--success-color)'; if (p.status === 'в обработке') sColor = 'var(--accent-color)'; if (p.status === 'кикнут') sColor = 'var(--danger-color)';
        
        const pNotes = allNotes.filter(n => n.player_id === p.id);
        const coachCount = pNotes.filter(n => n.note_type === 'coach').length;
        const tkCount = pNotes.filter(n => n.note_type === 'timekeeper').length;
        
        let badges = '';
        if (coachCount > 0) badges += `<span style="background:#4caf50; color:#000; padding:2px 6px; border-radius:10px; font-size:0.75em; font-weight:bold; line-height:1; flex-shrink:0;" title="Заметки тренера">📝 ${coachCount}</span>`;
        if (tkCount > 0) badges += `<span style="background:#9cdcfe; color:#000; padding:2px 6px; border-radius:10px; font-size:0.75em; font-weight:bold; line-height:1; flex-shrink:0;" title="Заметки табельщика">📋 ${tkCount}</span>`;

        div.innerHTML = `
            <div style="display:flex; flex-direction:column; flex: 1; min-width: 0; padding-right: 10px;">
                <div style="display:flex; align-items:center; flex-wrap:wrap; gap:5px; margin-bottom:4px;">
                    <span style="font-weight:bold; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${p.nickname}">${p.nickname}</span>
                    ${badges}
                </div>
                <span style="font-size:0.75em; color:${sColor};">${p.status || 'в клане'}</span>
            </div>
            <div style="color:#888; font-size:0.75em; text-align:right; flex-shrink:0; max-width:110px; word-break:break-all; line-height:1.1;">
                ${p.discord_id || 'ID: ' + p.id}
            </div>
        `;
        div.onclick = () => selectPlayer(p); container.appendChild(div);
    });
}

function filterPlayerList() { const i = document.getElementById('player-search-input'); if (i) renderPlayerList(i.value); }

async function selectPlayer(p) {
    currentEditId = p.id;
    document.getElementById('form-title').innerText = "Редактирование: " + p.nickname;
    document.getElementById('edit-player-id').value = p.id; document.getElementById('profile-nickname').value = p.nickname || '';
    document.getElementById('profile-discord-id').value = p.discord_id || ''; document.getElementById('profile-kd').value = p.kd || 0;
    document.getElementById('profile-kda').value = p.kda || 0; document.getElementById('profile-points').value = p.points || 0;
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
    
    const { data: stats } = await supabaseClient.from('match_stats').select('*').eq('player_id', p.id);
    if (stats && stats.length > 0) {
        let tK = 0, tD = 0, tA = 0, tP = 0;
        stats.forEach(s => { tK += s.kills || 0; tD += s.deaths || 0; tA += s.assists || 0; tP += s.points || 0; });
        let kd = tD === 0 ? tK : (tK / tD), kda = tD === 0 ? (tK + tA) : ((tK + tA) / tD);
        kd = Math.round(kd * 100) / 100; kda = Math.round(kda * 100) / 100;
        document.getElementById('profile-kd').value = kd; document.getElementById('profile-kda').value = kda; document.getElementById('profile-points').value = tP;
        await supabaseClient.from('players').update({ kd: kd, kda: kda, points: tP }).eq('id', p.id);
        p.kd = kd; p.kda = kda; p.points = tP; renderTops(); 
    }

    const { data: missed } = await supabaseClient.from('attendance').select('status').eq('player_id', p.id).eq('status', 'Не пришел');
    const missedBox = document.getElementById('player-missed-stats');
    if (missedBox) { missedBox.style.display = 'block'; document.getElementById('pm-absent').innerText = missed ? missed.length : 0; }

    const coachWrapper = document.getElementById('player-notes-wrapper');
    const tkWrapper = document.getElementById('player-timekeeper-notes-wrapper');
    if (coachWrapper) coachWrapper.style.display = 'block';
    if (tkWrapper) tkWrapper.style.display = 'block';
    await loadPlayerNotes(p.id);
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

    const coachWrapper = document.getElementById('player-notes-wrapper');
    const tkWrapper = document.getElementById('player-timekeeper-notes-wrapper');
    if (coachWrapper) coachWrapper.style.display = 'none';
    if (tkWrapper) tkWrapper.style.display = 'none';
    const coachList = document.getElementById('player-notes-list'); if (coachList) coachList.innerHTML = '';
    const tkList = document.getElementById('player-timekeeper-notes-list'); if (tkList) tkList.innerHTML = '';

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
    else { showToast('Профиль успешно сохранен!', 'success'); await loadAllData(); clearForm(); }
}

async function deletePlayer() {
    if (!currentEditId || !confirm('Удалить игрока?')) return;
    const { error } = await supabaseClient.from('players').delete().eq('id', currentEditId);
    if (error) showToast('Ошибка: ' + error.message, 'error'); 
    else { showToast('Игрок удален', 'success'); await loadAllData(); clearForm(); }
}

async function loadMyProfile(player) {
    if (!player) return; document.getElementById('my-profile-content').style.display = 'block';
    document.getElementById('my-kd').innerText = player.kd || 0; document.getElementById('my-kda').innerText = player.kda || 0;
    document.getElementById('my-points').innerText = player.points || 0;
    document.getElementById('my-squad').innerText = player.squad ? `${player.squad} (${player.role})` : 'Не в отряде';
    const statusEl = document.getElementById('my-status');
    if (statusEl) {
        statusEl.innerText = player.status || 'в клане';
        statusEl.style.color = player.status === 'в обработке' ? 'var(--accent-color)' : (player.status === 'кикнут' ? 'var(--danger-color)' : 'var(--success-color)');
    }
    const { data: fines } = await supabaseClient.from('fines').select('*').eq('player_id', player.id).order('created_at', { ascending: false });
    const fBody = document.getElementById('my-fines-body');
    fBody.innerHTML = fines.length === 0 ? '<tr><td colspan="3" style="text-align:center;">Штрафов нет</td></tr>' : '';
    fines.forEach(f => { fBody.innerHTML += `<tr><td>${f.reason}</td><td style="color:var(--danger-color);">${f.amount} ₽</td><td class="${f.status === 'open' ? 'status-open' : 'status-closed'}">${f.status === 'open' ? 'Открыт' : 'Закрыт'}</td></tr>`; });
    const { data: att } = await supabaseClient.from('attendance').select('*').eq('player_id', player.id);
    let max = maxAttendanceStage;
    if (allAttendance.length > 0) { const m = Math.max(...allAttendance.map(a => a.tournament_number)); if (m > max) max = m; }
    const th = document.getElementById('my-attendance-thead'); let hH = '<tr><th>Игрок</th>';
    for (let i = 1; i <= max; i++) hH += `<th>Этап ${i}</th>`; th.innerHTML = hH + '</tr>';
    const tb = document.getElementById('my-attendance-body'); let row = `<tr><td><strong>${player.nickname}</strong></td>`;
    for (let t = 1; t <= max; t++) {
        const r = att.find(a => a.tournament_number === t); const s = r ? r.status : 'Не отмечен';
        let c = s === 'Пришел' ? 'status-1' : (s === 'Не пришел' ? 'status-2' : (s === 'Отгул' ? 'status-3' : ''));
        row += `<td class="${c}">${s === 'Не отмечен' ? '-' : s}</td>`;
    }
    tb.innerHTML = row + '</tr>';
}

function initDragAndDrop(filterText = '') {
    const board = document.getElementById('roster-board'); if (!board) return; board.innerHTML = '';
    SQUADS_CONFIG.forEach(sq => {
        const card = document.createElement('div'); card.className = 'squad-card'; let rH = '';
        sq.roles.forEach(role => {
            const a = activePlayers.find(p => p.squad === sq.name && p.role === role);
            const n = a ? `<span style="cursor:pointer; color:var(--accent-color); text-decoration:underline;" onclick="event.stopPropagation(); goToPlayerProfile(${a.id})" title="Перейти в базу">${a.nickname}</span>` : 'Свободно';
            const c = a ? 'player-name' : 'empty-slot', id = a ? a.id : '';
            const rB = (a && isAdmin) ? `<button class="btn btn-danger" style="padding: 2px 6px; font-size: 0.7em; margin-left: 5px;" onclick="event.stopPropagation(); removeFromSquad(${a.id})">➖</button>` : '';
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
    
    if (free.length === 0) freeList.innerHTML = '<div style="text-align:center; color:#555;">Никого не найдено</div>';
    else free.forEach(p => {
        const i = document.createElement('div'); i.className = 'free-player-item'; i.draggable = isAdmin;
        i.ondragstart = (e) => { e.dataTransfer.setData('text/plain', p.id); i.classList.add('dragging'); };
        i.ondragend = () => i.classList.remove('dragging'); i.innerHTML = `<span>${p.nickname}</span>`; freeList.appendChild(i);
    });
}

async function handleDrop(event, slot) {
    event.preventDefault(); slot.classList.remove('drag-over'); if (!isAdmin) return;
    const id = event.dataTransfer.getData('text/plain'), sq = slot.dataset.squad, role = slot.dataset.role, ex = slot.dataset.playerId;
    if (!id) return; 
    
    if (ex && ex !== '') await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', ex);
    await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id);
    const { error } = await supabaseClient.from('players').update({ squad: sq, role: role }).eq('id', id);
    
    if (!error) { await loadAllData(); initDragAndDrop(); showToast('Игрок перемещен', 'success'); }
}

async function removeFromSquad(id) {
    if (!isAdmin || !confirm('Убрать игрока из отряда?')) return;
    await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', id);
    await loadAllData(); initDragAndDrop();
}

async function loadAttendance() {
    const { data: p } = await supabaseClient.from('players').select('*'), { data: a } = await supabaseClient.from('attendance').select('*');
    if (p) { allPlayers = p; activePlayers = p.filter(x => !x.status || x.status === 'в клане'); } if (a) allAttendance = a;
    let max = maxAttendanceStage; if (a && a.length > 0) { const m = Math.max(...a.map(x => x.tournament_number)); if (m > max) max = m; }
    maxAttendanceStage = max;
    const s = document.getElementById('modal-stage'); if (s) { s.innerHTML = ''; for (let i = 1; i <= max; i++) { const o = document.createElement('option'); o.value = i; o.textContent = `Этап ${i}`; s.appendChild(o); } }
    
    const th = document.getElementById('attendance-thead'); if (!th) return;
    let h = '<tr class="day-brackets-row"><th></th>', tC = Math.ceil(max / 3);
    for (let t = 0; t < tC; t++) { const st = Math.min(3, max - t * 3); h += `<th colspan="${st}" style="border: 2px solid var(--accent-color); border-bottom: none; border-radius: var(--radius) var(--radius) 0 0; color: var(--accent-color); font-weight: bold; text-align: center;">ТУРНИР ${t + 1}</th>`; }
    h += '</tr><tr><th>Боец</th>'; for (let i = 1; i <= max; i++) h += `<th>ЭТАП ${i}</th>`; th.innerHTML = h + '</tr>';
    
    const tb = document.getElementById('attendance-table-body'); if (!tb) return; tb.innerHTML = '';
    const searchInput = document.getElementById('attendance-search');
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const filteredPlayers = activePlayers.filter(p => p.nickname.toLowerCase().includes(searchQuery));

    filteredPlayers.forEach(p => {
        let row = `<tr><td>${p.nickname}</td>`;
        for (let t = 1; t <= max; t++) {
            const r = allAttendance.find(a => a.player_id === p.id && a.tournament_number === t); const st = r ? r.status : 'Не отмечен';
            let c = st === 'Пришел' ? 'status-1' : (st === 'Не пришел' ? 'status-2' : (st === 'Отгул' ? 'status-3' : ''));
            row += `<td><select class="${c}" ${!isAdmin ? 'disabled' : ''} onchange="updateAttendance(${p.id}, ${t}, this.value)"><option value="Не отмечен" ${st === 'Не отмечен' ? 'selected' : ''}>-</option><option value="Пришел" ${st === 'Пришел' ? 'selected' : ''}>Пришел</option><option value="Не пришел" ${st === 'Не пришел' ? 'selected' : ''}>Не пришел</option><option value="Отгул" ${st === 'Отгул' ? 'selected' : ''}>Отгул</option></select></td>`;
        }
        tb.innerHTML += row + '</tr>';
    });
}

async function updateAttendance(id, t, s) {
    if (!isAdmin) return;
    if (s === 'Не отмечен') await supabaseClient.from('attendance').delete().eq('player_id', id).eq('tournament_number', t);
    else await supabaseClient.from('attendance').upsert({ player_id: id, tournament_number: t, status: s }, { onConflict: 'player_id, tournament_number' });
    loadAttendance();
    if (document.getElementById('tab-missed').classList.contains('active')) loadAllMissed();
}

function addTournament() { maxAttendanceStage += 3; loadAttendance(); }
async function deleteTournament() {
    if (maxAttendanceStage <= 3 || !confirm(`Удалить последний турнир?`)) return;
    for (let i = maxAttendanceStage; i > maxAttendanceStage - 3; i--) await supabaseClient.from('attendance').delete().eq('tournament_number', i);
    maxAttendanceStage -= 3; loadAttendance();
}

async function loadAllMissed() {
    const tbody = document.getElementById('missed-table-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Загрузка...</td></tr>';

    const { data, error } = await supabaseClient.from('attendance').select('*, players(nickname)').eq('status', 'Не пришел').order('tournament_number', { ascending: true });

    if (error) { tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--danger-color);">Ошибка: ${error.message}</td></tr>`; return; }
    if (!data || data.length === 0) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:var(--success-color);">Прогулов нет.</td></tr>'; return; }

    const grouped = {};
    data.forEach(item => {
        const pId = item.player_id;
        const nick = item.players ? item.players.nickname : 'Удаленный игрок';
        if (!grouped[pId]) { grouped[pId] = { id: pId, nickname: nick, stages: [] }; }
        grouped[pId].stages.push(item.tournament_number);
    });

    tbody.innerHTML = '';
    const sortedPlayers = Object.values(grouped).sort((a, b) => b.stages.length - a.stages.length);

    sortedPlayers.forEach(p => {
        const groupedStages = {};
        p.stages.forEach(s => {
            const tourney = Math.ceil(s / 3);
            const stageInTourney = s % 3 === 0 ? 3 : s % 3;
            if (!groupedStages[tourney]) groupedStages[tourney] = [];
            groupedStages[tourney].push({ globalStage: s, stageInTourney: stageInTourney });
        });

        const stagesHtml = Object.keys(groupedStages).map(t => {
            const stagesList = groupedStages[t].sort((a,b)=>a.stageInTourney-b.stageInTourney).map(item => {
                return `<div style="display: inline-flex; align-items: center; gap: 5px; background: var(--input-bg); padding: 4px 8px; border-radius: var(--radius); border: 1px solid var(--border-color); margin-right: 10px; margin-bottom: 5px;">
                    <span style="font-size: 0.85em; color: var(--text-muted);">Э${item.stageInTourney}:</span>
                    <select class="missed-select" style="padding: 2px 5px; border: none; background: transparent; color: var(--accent-color); outline: none; cursor: pointer; font-size: 0.85em;" onchange="updateMissedStatus(${p.id}, ${item.globalStage}, this.value)">
                        <option value="Не пришел" selected>Не пришел</option>
                        <option value="Отгул">Отгул</option>
                        <option value="Пришел">Пришел</option>
                        <option value="Удалить">Удалить</option>
                    </select>
                </div>`;
            }).join('');
            return `<div style="display: flex; align-items: center; margin-bottom: 10px; flex-wrap: wrap;">
                        <div style="font-weight: bold; color: var(--text-muted); min-width: 90px;">Турнир ${t}:</div>
                        <div style="display: flex; flex-wrap: wrap;">${stagesList}</div>
                    </div>`;
        }).join('');

        tbody.innerHTML += `
            <tr>
                <td style="vertical-align: top; padding-top: 15px;"><strong>${p.nickname}</strong></td>
                <td style="vertical-align: top; padding-top: 15px; color: var(--danger-color); font-weight: bold; text-align: center; font-size: 1.2em;">${p.stages.length}</td>
                <td style="text-align: left; line-height: 1.4; padding: 10px;">${stagesHtml}</td>
            </tr>
        `;
    });
}

async function updateMissedStatus(playerId, globalStage, newStatus) {
    if (!isAdmin) return;
    if (newStatus === 'Удалить') { 
        await supabaseClient.from('attendance').delete().eq('player_id', playerId).eq('tournament_number', globalStage); 
    } else { 
        await supabaseClient.from('attendance').upsert({ player_id: playerId, tournament_number: globalStage, status: newStatus }, { onConflict: 'player_id, tournament_number' }); 
    }
    
    await loadAllMissed();
    if (document.getElementById('tab-attendance').classList.contains('active')) loadAttendance();
    showToast('Статус обновлен', 'success');
}

async function loadMatchStats() {
    const { data: p } = await supabaseClient.from('players').select('*'), { data: s } = await supabaseClient.from('match_stats').select('*');
    if (p) { allPlayers = p; activePlayers = p.filter(x => !x.status || x.status === 'в клане'); }
    
    const th = document.getElementById('stats-thead'); if (!th) return;
    let max = maxAttendanceStage; 
    if (s && s.length > 0) { const m = Math.max(...s.map(x => x.stage_number)); if (m > max) max = m; }
    
    let h = '<tr><th rowspan="2" style="vertical-align: middle;">Боец</th>';
    let tC = Math.ceil(max / 3);
    for (let t = 0; t < tC; t++) { const st = Math.min(3, max - t * 3); h += `<th colspan="${st * 4}" style="border-bottom: 1px solid var(--border-color); text-align:center;">ТУРНИР ${t + 1}</th>`; }
    h += '</tr><tr>';
    for (let i = 1; i <= max; i++) h += `<th colspan="4" style="text-align:center; color:var(--accent-color);">ЭТАП ${i}</th>`;
    h += '</tr><tr><th></th>'; 
    for (let i = 1; i <= max; i++) h += `<th style="font-size:0.75em; color:var(--text-muted);">K</th><th style="font-size:0.75em; color:var(--text-muted);">D</th><th style="font-size:0.75em; color:var(--text-muted);">A</th><th style="font-size:0.75em; color:var(--text-muted);">PTS</th>`;
    h += '</tr>';
    th.innerHTML = h;

    const tb = document.getElementById('stats-tbody'); if (!tb) return; tb.innerHTML = '';
    const searchInput = document.getElementById('stats-search');
    const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const filteredPlayers = activePlayers.filter(p => p.nickname.toLowerCase().includes(searchQuery));

    filteredPlayers.forEach(p => {
        let row = `<tr><td>${p.nickname}</td>`;
        for (let i = 1; i <= max; i++) {
            const r = s ? s.find(x => x.player_id === p.id && x.stage_number === i) : null;
            row += `<td><input type="number" id="s-k-${p.id}-${i}" value="${r ? r.kills : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'kills', this.value)" style="width:45px;"></td>
                <td><input type="number" id="s-d-${p.id}-${i}" value="${r ? r.deaths : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'deaths', this.value)" style="width:45px;"></td>
                <td><input type="number" id="s-a-${p.id}-${i}" value="${r ? r.assists : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'assists', this.value)" style="width:45px;"></td>
                <td><input type="number" id="s-p-${p.id}-${i}" value="${r ? r.points : ''}" onchange="updateMatchStat(${p.id}, ${i}, 'points', this.value)" style="width:55px;"></td>`;
        }
        tb.innerHTML += row + '</tr>';
    });
}

async function updateMatchStat(playerId, stageNum, field, value) {
    if (!isAdmin) return;
    const numVal = parseInt(value) || 0;
    const { data: existing } = await supabaseClient.from('match_stats').select('*').eq('player_id', playerId).eq('stage_number', stageNum).single();
    
    let payload = { player_id: playerId, stage_number: stageNum };
    if (existing) payload = { ...existing, [field]: numVal };
    else {
        payload.kills = field === 'kills' ? numVal : 0; payload.deaths = field === 'deaths' ? numVal : 0;
        payload.assists = field === 'assists' ? numVal : 0; payload.points = field === 'points' ? numVal : 0;
    }
    await supabaseClient.from('match_stats').upsert(payload, { onConflict: 'player_id, stage_number' });
    await recalculatePlayerStats(playerId);
}

async function recalculatePlayerStats(playerId) {
    if (!playerId) return;
    const { data: stats } = await supabaseClient.from('match_stats').select('*').eq('player_id', playerId);
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

function addStage() { maxAttendanceStage += 3; loadMatchStats(); }
function deleteStage() {
    if (maxAttendanceStage <= 3 || !confirm(`Удалить последний турнир?`)) return;
    maxAttendanceStage -= 3; loadMatchStats();
}

// ==================== ЛОГИКА СРАВНЕНИЯ (ДО 4 ЧЕЛОВЕК) ====================
function initCompareTab() {
    const select = document.getElementById('compare-players');
    const periodSelect = document.getElementById('compare-period');
    if (!select || !periodSelect) return;

    if (select.tomselect) select.tomselect.destroy();
    if (periodSelect.tomselect) periodSelect.tomselect.destroy();

    let options = '';
    activePlayers.forEach(p => { options += `<option value="${p.id}">${p.nickname}</option>`; });
    select.innerHTML = options;

    new TomSelect(select, { 
        create: false, 
        sortField: { field: "text", direction: "asc" }, 
        maxItems: 4, 
        plugins: ['remove_button'],
        onChange: () => renderComparison() 
    });
    
    new TomSelect(periodSelect, {
        create: false, onChange: () => renderComparison()
    });
}

function renderComparison() {
    const selectEl = document.getElementById('compare-players');
    const container = document.getElementById('compare-results');
    if (!selectEl || !selectEl.tomselect) return;

    const selectedIds = Array.from(selectEl.tomselect.getValue());
    
    if (selectedIds.length < 2) { 
        container.innerHTML = '<div style="text-align:center; color:var(--text-muted); padding: 20px; text-transform: uppercase;">Выберите хотя бы двух бойцов</div>'; 
        return; 
    }

    const players = selectedIds.map(id => allPlayers.find(p => p.id == id)).filter(Boolean);

    let thead = '<thead><tr><th>Характеристика</th>';
    players.forEach(p => { thead += `<th>${p.nickname} ${p.squad ? `<br><small style="color:var(--text-muted)">${p.squad}</small>` : ''}</th>`; });
    thead += '</tr></thead>';

    const stats = [
        { label: 'КД (K/D)', key: 'kd', higher: true },
        { label: 'КДА (KDA)', key: 'kda', higher: true },
        { label: 'Очки', key: 'points', higher: true },
        { label: 'Кувалда', key: 'has_sledgehammer', isBool: true },
        { label: 'Автомат', key: 'main_rifle' },
        { label: 'ПП', key: 'main_smg' },
        { label: 'Снайперка', key: 'sniper' },
        { label: 'Пистолет', key: 'secondary_pistol' },
        { label: 'Пулемет', key: 'machine_gun' },
        { label: 'Дробовик', key: 'shotgun' },
        { label: 'Боевая броня', key: 'armor_combat' },
        { label: 'Комбинированная', key: 'armor_combined' },
    ];

    let tbody = '<tbody>';
    stats.forEach(stat => {
        tbody += `<tr><td>${stat.label}</td>`;
        
        let bestVal = null;
        if (stat.higher) {
            bestVal = Math.max(...players.map(p => stat.isBool ? (p[stat.key] ? 1 : 0) : (parseFloat(p[stat.key]) || 0)));
        }

        players.forEach(p => {
            let val = p[stat.key];
            if (stat.isBool) {
                tbody += `<td>${val ? '<span class="compare-winner">🔨 Есть</span>' : '<span class="compare-loser">❌ Нет</span>'}</td>`;
            } else if (stat.higher) {
                let numVal = parseFloat(val) || 0;
                let isWinner = numVal === bestVal && players.filter(x => (parseFloat(x[stat.key]) || 0) === bestVal).length < players.length;
                tbody += `<td class="${isWinner ? 'compare-winner' : ''}">${val !== null && val !== undefined && val !== '' ? val : '-'}</td>`;
            } else {
                tbody += `<td>${val !== null && val !== undefined && val !== '' ? val : '-'}</td>`;
            }
        });
        tbody += '</tr>';
    });
    tbody += '</tbody>';

    container.innerHTML = `<table class="compare-table">${thead}${tbody}</table>`;
}
// =======================================================================

async function loadMatchHistory() {
    const timeline = document.getElementById('history-timeline');
    if (!timeline) return;
    timeline.innerHTML = '<div style="text-align:center; width:100%;">Загрузка...</div>';

    const { data: matches } = await supabaseClient.from('clan_matches').select('*').order('match_date', { ascending: true });
    
    let wins = 0, losses = 0, draws = 0;
    let totalRating = 1000;
    let totalGears = 0;
    
    if (!matches || matches.length === 0) {
        timeline.innerHTML = '<div style="text-align:center; width:100%;">Нет сохраненных матчей</div>';
        renderHistoryChart(0, 0, 0);
        updateHistoryStats(1000, 'E', 0, 0, 0, 0);
        return;
    }

    // Фильтруем матчи по выбранному сезону
    const filteredMatches = matches.filter(m => filterBySeason(Math.ceil((m.stage_number || 0) / 3)));

    filteredMatches.forEach(match => {
        const cScore = match.clan_score || 0;
        const eScore = match.enemy_points || 0;
        
        if (cScore > eScore) {
            const currentTier = getTierData(totalRating);
            totalRating += 50;
            totalGears += currentTier.winGears;
            wins++;
        } else if (cScore < eScore) {
            const currentTier = getTierData(totalRating);
            totalRating -= 50;
            if (cScore >= (eScore * 0.2)) {
                totalGears += currentTier.lossGears;
            }
            losses++;
        } else {
            draws++;
        }
    });

    const finalTier = getTierData(totalRating);
    updateHistoryStats(totalRating, finalTier.name, totalGears, wins, losses, draws);

    timeline.innerHTML = '';
    const reversedMatches = [...filteredMatches].reverse();
    
    reversedMatches.forEach((match, index) => {
        const isLeft = index % 2 === 0;
        const dateStr = match.match_date ? new Date(match.match_date).toLocaleDateString('ru-RU') : 'Дата не указана';
        const cScore = match.clan_score || 0;
        const eScore = match.enemy_points || 0;
        const opponent = match.enemy_name || 'Неизвестный враг';
        const mapName = match.map_name || 'Не указана';

        let scoreClass = '';
        let winText = '';
        if (cScore > eScore) { scoreClass = 'score-win'; winText = 'ПОБЕДА'; }
        else if (cScore < eScore) { scoreClass = 'score-loss'; winText = 'ПОРАЖЕНИЕ'; }
        else { winText = 'НИЧЬЯ'; }

        const adminEdit = isAdmin ? `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed var(--border-color); display: flex; flex-direction: column; gap: 10px;">
                <input type="date" value="${match.match_date || ''}" onchange="updateMatchData(${match.id}, 'date', this.value)" style="background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:5px; border-radius:4px;">
                <input type="text" value="${opponent}" onchange="updateMatchData(${match.id}, 'enemy_name', this.value)" placeholder="Имя врага" style="background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:5px; border-radius:4px;">
                
                <select onchange="updateMatchData(${match.id}, 'map_name', this.value)" style="background:var(--input-bg); color:#ff9800; border:1px solid var(--border-color); padding:5px; border-radius:4px; font-weight:bold; width:100%;">
                    <option value="">-- Выберите карту --</option>
                    <option value="Низина" ${match.map_name === 'Низина' ? 'selected' : ''}>Низина</option>
                    <option value="Малая Бердовка" ${match.map_name === 'Малая Бердовка' ? 'selected' : ''}>Малая Бердовка</option>
                    <option value="Хвойный" ${match.map_name === 'Хвойный' ? 'selected' : ''}>Хвойный</option>
                </select>

                <div style="display:flex; gap:5px;">
                    <input type="number" value="${cScore}" onchange="updateMatchData(${match.id}, 'clan_score', this.value)" placeholder="Наши очки" style="flex:1; background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:5px; border-radius:4px;">
                    <input type="number" value="${eScore}" onchange="updateMatchData(${match.id}, 'enemy_points', this.value)" placeholder="Очки врага" style="flex:1; background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color); padding:5px; border-radius:4px;">
                </div>
                <button class="btn btn-danger" style="padding: 5px; font-size: 0.8em;" onclick="deleteMatch(${match.id})">Удалить матч</button>
            </div>
        ` : '';

        const stageBadge = match.stage_number ? `<div style="font-size:0.8em; color:var(--accent-color); margin-bottom:5px;">Этап ${match.stage_number}</div>` : '';
        const mapBadge = `<div style="font-size:0.85em; color:#9cdcfe; margin-bottom:5px;">🗺️ ${mapName}</div>`;

        timeline.innerHTML += `
            <div class="timeline-item ${isLeft ? 'left' : 'right'}">
                <div class="timeline-content">
                    ${stageBadge}
                    ${mapBadge}
                    <div class="timeline-date">${dateStr}</div>
                    <div class="timeline-opponent">vs <strong>${opponent}</strong></div>
                    <div class="timeline-score ${scoreClass}">${cScore} : ${eScore}</div>
                    <div style="color:var(--text-muted); font-size:0.9em; margin-top:5px;">${winText}</div>
                    ${adminEdit}
                </div>
            </div>
        `;
    });

    renderHistoryChart(wins, losses, draws);
}

function updateHistoryStats(rating, tierName, gears, wins, losses, draws) {
    const ratingEl = document.getElementById('hr-rating'); if (ratingEl) ratingEl.innerText = rating;
    const tierEl = document.getElementById('hr-tier'); if (tierEl) tierEl.innerText = tierName + ' Тир';
    const gearsEl = document.getElementById('hr-gears'); if (gearsEl) gearsEl.innerText = gears;

    const total = wins + losses + draws;
    const winPct = total > 0 ? Math.round((wins / total) * 100) : 0;
    const lossPct = total > 0 ? Math.round((losses / total) * 100) : 0;
    const drawPct = total > 0 ? Math.round((draws / total) * 100) : 0;

    const hrWins = document.getElementById('hr-wins'); if (hrWins) hrWins.innerText = wins;
    const hrLosses = document.getElementById('hr-losses'); if (hrLosses) hrLosses.innerText = losses;
    const hrDraws = document.getElementById('hr-draws'); if (hrDraws) hrDraws.innerText = draws;
    const hrTotal = document.getElementById('hr-total'); if (hrTotal) hrTotal.innerText = total;

    const hrWinsPct = document.getElementById('hr-wins-pct'); if (hrWinsPct) hrWinsPct.innerText = winPct + '%';
    const hrLossesPct = document.getElementById('hr-losses-pct'); if (hrLossesPct) hrLossesPct.innerText = lossPct + '%';
    const hrDrawsPct = document.getElementById('hr-draws-pct'); if (hrDrawsPct) hrDrawsPct.innerText = drawPct + '%';
}

async function addMatchHistory() {
    const date = prompt("Введите дату матча (ГГГГ-ММ-ДД):", new Date().toISOString().split('T')[0]);
    if (!date) return;
    
    const { error } = await supabaseClient.from('clan_matches').insert([{ match_date: date, clan_score: 0, enemy_points: 0, enemy_name: 'Новый враг', map_name: 'Низина' }]);
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else { showToast('Матч добавлен', 'success'); loadMatchHistory(); }
}

async function updateMatchData(id, field, value) {
    if (!isAdmin) return;
    let val = value;
    if (field === 'clan_score' || field === 'enemy_points') val = parseInt(value) || 0;
    
    const { error } = await supabaseClient.from('clan_matches').update({ [field]: val }).eq('id', id);
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else { showToast('Данные обновлены', 'success'); loadMatchHistory(); }
}

async function deleteMatch(id) {
    if (!isAdmin || !confirm('Удалить этот матч?')) return;
    const { error } = await supabaseClient.from('clan_matches').delete().eq('id', id);
    if (error) showToast('Ошибка: ' + error.message, 'error');
    else { showToast('Матч удален', 'success'); loadMatchHistory(); }
}

function renderHistoryChart(wins, losses, draws = 0) {
    const canvas = document.getElementById('matchHistoryChart');
    if (!canvas) return;

    if (myChart) { myChart.destroy(); }

    const hasData = wins > 0 || losses > 0 || draws > 0;
    
    myChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: ['Победы', 'Поражения', 'Ничьи'],
            datasets: [{
                data: hasData ? [wins, losses, draws] : [1, 0, 0],
                backgroundColor: hasData ? ['#4caf50', '#e53935', '#ff9800'] : ['#2a3a2a', '#2a3a2a', '#2a3a2a'],
                borderColor: '#0d0f0d',
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { labels: { color: '#d1d5d1', font: { family: 'Courier New', weight: 'bold' } } },
                tooltip: { enabled: hasData }
            },
            cutout: '70%'
        }
    });
}

// ==================== КАЛЕНДАРЬ ====================
async function loadCalendar() {
    const list = document.getElementById('calendar-list');
    if (!list) return;
    list.innerHTML = 'Загрузка...';

    // Получаем данные из БД
    const { data: events } = await supabaseClient.from('clan_calendar').select('*').order('match_date', { ascending: true }).order('stage_number', { ascending: true });
    const { data: matches } = await supabaseClient.from('clan_matches').select('stage_number');
    
    // Вычисляем максимальный турнир для подсказки
    let maxStage = 0;
    if (matches && matches.length > 0) { maxStage = Math.max(...matches.map(m => m.stage_number || 0)); }
    const maxTourney = Math.ceil(maxStage / 3) || 0;
    
    // Заполняем поле с автоинкрементом
    const startTourneyInput = document.getElementById('bulk-start-tournament');
    if (startTourneyInput) startTourneyInput.value = maxTourney + 1;

    // Фильтруем по сезону
    const filteredEvents = (events || []).filter(e => filterBySeason(e.tournament_number || 0));

    if (filteredEvents.length === 0) {
        list.innerHTML = '<div style="text-align:center; padding:20px; color:var(--text-muted);">Нет запланированных турниров в этом сезоне</div>';
        return;
    }

    list.innerHTML = '';
    filteredEvents.forEach(e => {
        const dateStr = e.match_date ? new Date(e.match_date).toLocaleDateString('ru-RU') : 'Дата не указана';
        const timeStr = e.match_time ? e.match_time.slice(0, 5) : '';
        
        list.innerHTML += `
            <div class="calendar-card" style="margin-bottom:15px; display:flex; justify-content:space-between; align-items:center;">
                <div>
                    <div style="color:var(--accent-color); font-weight:bold; font-size:1.2em;">${dateStr} ${timeStr ? 'в ' + timeStr : ''}</div>
                    <div style="margin-top:5px;">Турнир: <strong>${e.tournament_number || '-'}</strong> ${e.stage_number ? '| Этап: ' + e.stage_number : ''}</div>
                    <div style="color:var(--text-muted); font-size:0.9em; margin-top:5px;">${e.notes || ''}</div>
                </div>
                ${isAdmin ? `<button class="btn btn-danger" onclick="deleteCalendarEvent(${e.id})">X</button>` : ''}
            </div>
        `;
    });
}

async function addUpcomingMatch() {
    if (!isAdmin) return;
    const date = document.getElementById('cal-date').value;
    const time = document.getElementById('cal-time').value;
    const tourney = parseInt(document.getElementById('cal-tournament').value) || null;
    const stage = parseInt(document.getElementById('cal-stage').value) || null;
    const notes = document.getElementById('cal-notes').value.trim();

    if (!date) return showToast('Выберите дату', 'error');

    const { error } = await supabaseClient.from('clan_calendar').insert([{
        match_date: date,
        match_time: time || null,
        tournament_number: tourney,
        stage_number: stage,
        notes: notes
    }]);

    if (error) return showToast('Ошибка: ' + error.message, 'error');
    showToast('Турнир добавлен в календарь', 'success');
    loadCalendar();
}

async function generateBulkCalendar() {
    if (!isAdmin) return;
    const startStr = document.getElementById('bulk-start').value;
    const endStr = document.getElementById('bulk-end').value;
    const time = document.getElementById('bulk-time').value;
    const notes = document.getElementById('bulk-notes').value.trim();
    
    let startTourney = parseInt(document.getElementById('bulk-start-tournament').value) || 1;
    
    if (!startStr || !endStr) return showToast('Укажите даты начала и конца', 'error');
    
    const selectedDays = Array.from(document.querySelectorAll('.bulk-day:checked')).map(cb => parseInt(cb.value));
    if (selectedDays.length === 0) return showToast('Выберите хотя бы один день недели', 'error');
    
    const btn = event.target;
    btn.disabled = true;
    btn.innerText = 'Генерация...';

    let current = new Date(startStr);
    const end = new Date(endStr);
    const events = [];
    let currentTourney = startTourney;
    
    // Проходим по каждому дню в диапазоне
    while (current <= end) {
        if (selectedDays.includes(current.getDay())) {
            // Формат YYYY-MM-DD
            const year = current.getFullYear();
            const month = String(current.getMonth() + 1).padStart(2, '0');
            const day = String(current.getDate()).padStart(2, '0');
            const dateStr = `${year}-${month}-${day}`;
            
            // Генерируем 3 этапа на каждый выбранный день для текущего турнира
            for (let stageNum = 1; stageNum <= 3; stageNum++) {
                events.push({
                    match_date: dateStr,
                    match_time: time || null,
                    tournament_number: currentTourney,
                    stage_number: stageNum,
                    notes: notes
                });
            }
            currentTourney++; // Увеличиваем номер турнира после полного заполнения дня (3 этапа)
        }
        current.setDate(current.getDate() + 1);
    }
    
    if (events.length === 0) {
        btn.disabled = false;
        btn.innerText = 'Сгенерировать события';
        return showToast('В выбранном диапазоне нет подходящих дней', 'info');
    }
    
    // Отправляем в базу пакетом
    const { error } = await supabaseClient.from('clan_calendar').insert(events);
    
    btn.disabled = false;
    btn.innerText = 'Сгенерировать события';
    
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    
    showToast(`Успешно добавлено ${events.length / 3} турниров (${events.length} этапов)!`, 'success');
    document.getElementById('bulk-start').value = '';
    document.getElementById('bulk-end').value = '';
    loadCalendar();
}

async function deleteCalendarEvent(id) {
    if (!isAdmin || !confirm('Удалить это событие?')) return;
    await supabaseClient.from('clan_calendar').delete().eq('id', id);
    loadCalendar();
}
// ==================================================

async function loadFines() {
    const { data } = await supabaseClient.from('fines').select('*, players(nickname)').order('created_at', { ascending: false });
    if (data) { allFines = data; const tb = document.getElementById('fines-table-body'); if (!tb) return;
        tb.innerHTML = allFines.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Нет штрафов</td></tr>' : '';
        allFines.forEach(f => { tb.innerHTML += `<tr><td><strong>${f.players?.nickname || 'Неизвестный'}</strong></td><td>${f.reason}</td><td style="color:var(--danger-color);">${f.amount} ₽</td><td class="${f.status === 'open' ? 'status-open' : 'status-closed'}">${f.status === 'open' ? 'Открыт' : 'Закрыт'}</td><td><button class="btn" onclick="toggleFineStatus(${f.id}, '${f.status}')">${f.status === 'open' ? 'Закрыть' : 'Открыть'}</button><button class="btn btn-danger" onclick="deleteFine(${f.id})">X</button></td></tr>`; });
    }
}

async function addFine() {
    const pid = document.getElementById('fine-player').value, r = document.getElementById('fine-reason').value.trim(), a = parseInt(document.getElementById('fine-amount').value) || 0;
    if (!pid || !r) return showToast('Выберите игрока и укажите причину', 'error');
    const { error } = await supabaseClient.from('fines').insert([{ player_id: pid, reason: r, amount: a, status: 'open' }]);
    if (error) showToast('Ошибка: ' + error.message, 'error'); 
    else { showToast('Штраф добавлен', 'success'); document.getElementById('fine-reason').value = ''; document.getElementById('fine-amount').value = ''; loadFines(); }
}

async function toggleFineStatus(id, st) { await supabaseClient.from('fines').update({ status: st === 'open' ? 'closed' : 'open' }).eq('id', id); loadFines(); }
async function deleteFine(id) { if (confirm('Удалить штраф?')) { await supabaseClient.from('fines').delete().eq('id', id); loadFines(); } }

function openPhotoModal(input) {
    const file = input.files[0]; if (!file) return;
    currentPhotoFile = file; document.getElementById('photo-modal').style.display = 'flex';
    const r = new FileReader(); r.onload = (e) => { document.getElementById('preview-img').src = e.target.result; document.getElementById('photo-preview').style.display = 'block'; }; r.readAsDataURL(file);
}

function closePhotoModal() {
    document.getElementById('photo-modal').style.display = 'none'; document.getElementById('attendance-photo').value = '';
    document.getElementById('photo-preview').style.display = 'none'; currentPhotoFile = null;
}

async function saveAbsentStatuses() {
    const btn = document.getElementById('save-absent-btn');
    btn.disabled = true; btn.innerText = '...';

    for (const p of pendingAbsentPlayers) {
        const sel = document.getElementById(`absent-status-${p.id}`);
        const status = sel ? sel.value : 'Не пришел';
        await supabaseClient.from('attendance').upsert({ player_id: p.id, tournament_number: currentAbsentStage, status: status }, { onConflict: 'player_id, tournament_number' });
    }

    document.getElementById('absent-modal').style.display = 'none';
    document.getElementById('photo-status').innerHTML = `СТАТУСЫ ОБНОВЛЕНЫ.`;
    
    await loadAllData();
    if (document.getElementById('tab-attendance').classList.contains('active')) loadAttendance();
    if (document.getElementById('tab-stats').classList.contains('active')) loadMatchStats();
    if (document.getElementById('tab-analytics').classList.contains('active')) loadAnalytics();
    if (document.getElementById('tab-history').classList.contains('active')) loadMatchHistory();
    
    btn.disabled = false; btn.innerText = 'ПОДТВЕРДИТЬ';
    showToast('Статусы сохранены!', 'success');
}

async function confirmPhotoUpload() {
    if (!currentPhotoFile) return;
    const stageNum = parseInt(document.getElementById('modal-stage').value), statusDiv = document.getElementById('photo-status');
    document.getElementById('photo-modal').style.display = 'none'; statusDiv.innerHTML = 'РАСПОЗНАЕМ...';

    const compressImage = (file) => {
        return new Promise((resolve) => {
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
    };

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
        let found = activePlayers.find(p => normalizeStr(p.nickname) === aiClean);
        if (found) return found;
        let bestMatch = null, bestDistance = Infinity;
        activePlayers.forEach(p => {
            const dbClean = normalizeStr(p.nickname);
            if ((dbClean.includes(aiClean) || aiClean.includes(dbClean)) && Math.abs(dbClean.length - aiClean.length) <= 3) { bestMatch = p; bestDistance = 0; return; }
            const distance = levenshtein(dbClean, aiClean);
            const maxAllowedDist = aiClean.length > 6 ? 2 : 1;
            if (distance <= maxAllowedDist && distance < bestDistance) { bestDistance = distance; bestMatch = p; }
        });
        return bestMatch;
    };

    try {
        const base64 = await compressImage(currentPhotoFile);
        const res = await fetch('https://rpqiapddvlkdecddczqx.supabase.co/functions/v1/recognize', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_KEY}` }, body: JSON.stringify({ image: base64 }) });
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
        const result = await res.json();
        
        if (result.players && result.players.length > 0) {
            let added = 0, notFound = [], presentPlayerIds = new Set();
            for (const p of result.players) {
                const pl = findPlayerSmart(p.nickname);
                if (pl) {
                    presentPlayerIds.add(pl.id);
                    await supabaseClient.from('attendance').upsert({ player_id: pl.id, tournament_number: stageNum, status: 'Пришел' }, { onConflict: 'player_id, tournament_number' });
                    await supabaseClient.from('match_stats').upsert({ player_id: pl.id, stage_number: stageNum, kills: p.kills || 0, deaths: p.deaths || 0, assists: p.assists || 0, points: p.points || 0 }, { onConflict: 'player_id, stage_number' });
                    await recalculatePlayerStats(pl.id);
                    added++;
                } else { notFound.push(p.nickname); }
            }

            if (result.clan_score !== undefined && result.enemy_score !== undefined && result.clan_score > 0) {
                const today = new Date().toISOString().split('T')[0];
                const { error: matchError } = await supabaseClient.from('clan_matches').upsert({
                    stage_number: stageNum,
                    match_date: today,
                    clan_score: result.clan_score,
                    enemy_points: result.enemy_score,
                    enemy_name: result.enemy_name || 'Неизвестный враг',
                    map_name: result.map_name || 'Низина'
                }, { onConflict: 'stage_number' });

                if (!matchError) showToast(`Матч (Этап ${stageNum}) записан в Историю!`, 'info');
            }

            pendingAbsentPlayers = [];
            activePlayers.forEach(pl => { if (!presentPlayerIds.has(pl.id)) pendingAbsentPlayers.push(pl); });

            statusDiv.innerHTML = `ПРИШЛО: ${added}.`;
            if (notFound.length > 0) statusDiv.innerHTML += `<br>НЕ НАЙДЕНЫ: ${notFound.join(', ')}`;

            if (pendingAbsentPlayers.length > 0) {
                currentAbsentStage = stageNum;
                const listContainer = document.getElementById('absent-players-list'); listContainer.innerHTML = '';
                pendingAbsentPlayers.forEach(p => {
                    const row = document.createElement('div');
                    row.style.cssText = 'display:flex; justify-content:space-between; align-items:center; padding:8px; border-bottom:1px solid var(--border-color); margin-bottom:5px;';
                    row.innerHTML = `<span style="font-weight:bold;">${p.nickname}</span><select id="absent-status-${p.id}" style="padding:5px; border-radius:var(--radius); background:var(--input-bg); color:var(--text-color); border:1px solid var(--border-color);"><option value="Не пришел">Не пришел</option><option value="Отгул">Отгул</option></select>`;
                    listContainer.appendChild(row);
                });
                document.getElementById('absent-modal').style.display = 'flex';
                statusDiv.innerHTML += `<br>ПОДТВЕРДИТЕ СТАТУСЫ (${pendingAbsentPlayers.length})`;
                showToast(`Распознано ${added} игроков`, 'info');
            } else {
                await loadAllData(); 
                if (document.getElementById('tab-attendance').classList.contains('active')) loadAttendance();
                if (document.getElementById('tab-stats').classList.contains('active')) loadMatchStats();
                if (document.getElementById('tab-analytics').classList.contains('active')) loadAnalytics();
                if (document.getElementById('tab-history').classList.contains('active')) loadMatchHistory();
                showToast(`Успешно распознано ${added} игроков!`, 'success');
            }
        } else { statusDiv.innerHTML = `НЕ УДАЛОСЬ РАСПОЗНАТЬ.`; showToast('Ошибка распознавания', 'error'); }
    } catch (err) { console.error(err); statusDiv.innerHTML = `ОШИБКА: ${err.message}`; showToast('Ошибка нейросети', 'error'); }
    closePhotoModal(); document.getElementById('attendance-photo').value = '';
}

async function loadAnalytics() {
    const { data: players } = await supabaseClient.from('players').select('*'); 
    if (!players) return;
    const active = players.filter(p => !p.status || p.status ===  'в клане');
    
    const topKD = [...active].sort((a, b) => b.kd - a.kd).slice(0, 10);
    document.querySelector('#top-kd-table tbody').innerHTML = topKD.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.kd}</td></tr>`).join('');
    const topKDA = [...active].sort((a, b) => b.kda - a.kda).slice(0, 10);
    document.querySelector('#top-kda-table tbody').innerHTML = topKDA.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.kda}</td></tr>`).join('');
    const topP = [...active].sort((a, b) => b.points - a.points).slice(0, 10);
    document.querySelector('#top-points-table tbody').innerHTML = topP.map((p, i) => `<tr><td>${i+1}</td><td>${p.nickname}</td><td>${p.points}</td></tr>`).join('');
    
    document.getElementById('stat-total-players').innerText = active.length;
    const inS = active.filter(p => p.squad && p.squad.trim() !== '').length;
    document.getElementById('stat-in-squads').innerText = inS; document.getElementById('stat-free').innerText = active.length - inS;

    if (active.length > 0) {
        const sumKd = active.reduce((acc, p) => acc + (p.kd || 0), 0);
        const sumKda = active.reduce((acc, p) => acc + (p.kda || 0), 0);
        const sumPts = active.reduce((acc, p) => acc + (p.points || 0), 0);

        document.getElementById('avg-kd-total').innerText = (sumKd / active.length).toFixed(2);
        document.getElementById('avg-kda-total').innerText = (sumKda / active.length).toFixed(2);
        document.getElementById('avg-points-total').innerText = Math.round(sumPts / active.length);

        const { data: allStats } = await supabaseClient.from('match_stats').select('*');
        if (allStats && allStats.length > 0) {
            const activeIds = new Set(active.map(p => p.id));
            const activeStats = allStats.filter(s => activeIds.has(s.player_id));
            if (activeStats.length > 0) {
                let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalPoints = 0;
                activeStats.forEach(s => {
                    totalKills += s.kills || 0; totalDeaths += s.deaths || 0; totalAssists += s.assists || 0; totalPoints += s.points || 0;
                });
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

    const mapStatsBody = document.querySelector('#map-stats-table tbody');
    if (mapStatsBody) {
        const { data: matches } = await supabaseClient.from('clan_matches').select('*');
        if (matches && matches.length > 0) {
            // Фильтруем по сезону
            const filteredMatches = matches.filter(m => filterBySeason(Math.ceil((m.stage_number || 0) / 3)));
            const mapData = {};
            filteredMatches.forEach(m => {
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
            mapStatsBody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Нет данных о картах</td></tr>';
        }
    }
}

async function loadPlayerNotes(playerId) {
    const { data: notes, error } = await supabaseClient
        .from('player_notes')
        .select('*')
        .eq('player_id', playerId)
        .order('created_at', { ascending: false });

    const coachList = document.getElementById('player-notes-list');
    const tkList = document.getElementById('player-timekeeper-notes-list');
    if (!coachList || !tkList) return;

    if (error) {
        coachList.innerHTML = `<div style="color:var(--danger-color); font-size:0.85em; text-align:center; padding:8px;">Ошибка: ${error.message}</div>`;
        tkList.innerHTML = '';
        return;
    }

    const coachNotes = (notes || []).filter(n => n.note_type === 'coach');
    const tkNotes = (notes || []).filter(n => n.note_type === 'timekeeper');

    const renderNotes = (arr) => arr.length === 0
        ? '<div style="color:var(--text-muted); font-size:0.85em; text-align:center; padding:8px;">Заметок нет</div>'
        : arr.map(n => {
            const dateStr = n.created_at ? new Date(n.created_at).toLocaleDateString('ru-RU') : '';
            return `
            <div style="background:var(--card-bg); border:1px solid var(--border-color); border-radius:var(--radius); padding:8px 10px; margin-bottom:6px; font-size:0.9em; display:flex; justify-content:space-between; gap:8px; align-items:flex-start;">
                <div style="flex:1; word-break:break-word;">
                    <div style="color:var(--text-muted); font-size:0.75em; margin-bottom:3px;">${dateStr}</div>
                    <div>${n.content}</div>
                </div>
                <button class="btn btn-danger" style="padding:2px 8px; font-size:0.75em;" onclick="deletePlayerNote(${n.id}, ${playerId})">✕</button>
            </div>`;
        }).join('');

    coachList.innerHTML = renderNotes(coachNotes);
    tkList.innerHTML = renderNotes(tkNotes);
}

async function addPlayerNote(type) {
    if (!currentEditId) return showToast('Сначала выберите игрока', 'error');
    const inputId = type === 'coach' ? 'player-note-input' : 'player-timekeeper-note-input';
    const input = document.getElementById(inputId);
    if (!input) return;
    const content = input.value.trim();
    if (!content) return showToast('Введите текст заметки', 'error');

    const { error } = await supabaseClient.from('player_notes').insert([{
        player_id: currentEditId,
        note_type: type,
        content: content
    }]);

    if (error) return showToast('Ошибка: ' + error.message, 'error');
    input.value = '';
    showToast('Заметка добавлена', 'success');
    
    const { data: notesData } = await supabaseClient.from('player_notes').select('*');
    if (notesData) { allNotes = notesData; renderPlayerList(); }
    
    await loadPlayerNotes(currentEditId);
}

async function deletePlayerNote(noteId, playerId) {
    if (!confirm('Удалить заметку?')) return;
    const { error } = await supabaseClient.from('player_notes').delete().eq('id', noteId);
    if (error) return showToast('Ошибка: ' + error.message, 'error');
    showToast('Заметка удалена', 'success');
    
    const { data: notesData } = await supabaseClient.from('player_notes').select('*');
    if (notesData) { allNotes = notesData; renderPlayerList(); }

    await loadPlayerNotes(playerId);
}

const ANALYTICS_CHANNEL_ID = '1567231595797028874';
const ROSTER_CHANNEL_ID = '1567230953833627668';

async function sendAnalyticsScreenshot() {
    const { data: players } = await supabaseClient.from('players').select('*'); 
    if (!players) return showToast('Нет данных для аналитики', 'error');
    const active = players.filter(p => !p.status || p.status === 'в клане');
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

    const sumKd = active.reduce((acc, p) => acc + (p.kd || 0), 0);
    const sumKda = active.reduce((acc, p) => acc + (p.kda || 0), 0);
    const sumPts = active.reduce((acc, p) => acc + (p.points || 0), 0);
    const avgKdTotal = (sumKd / active.length || 0).toFixed(2);
    const avgKdaTotal = (sumKda / active.length || 0).toFixed(2);
    const avgPtsTotal = Math.round(sumPts / active.length) || 0;

    let avgKdStage = '0.00', avgKdaStage = '0.00', avgPtsStage = '0';
    const { data: allStats } = await supabaseClient.from('match_stats').select('*');
    if (allStats && allStats.length > 0) {
        const activeIds = new Set(active.map(p => p.id));
        const activeStats = allStats.filter(s => activeIds.has(s.player_id));
        if (activeStats.length > 0) {
            let tK = 0, tD = 0, tA = 0, tP = 0;
            activeStats.forEach(s => { tK += s.kills || 0; tD += s.deaths || 0; tA += s.assists || 0; tP += s.points || 0; });
            let kdSt = tD === 0 ? tK : (tK / tD);
            let kdaSt = tD === 0 ? (tK + tA) : ((tK + tA) / tD);
            const stCount = Math.max(...activeStats.map(s => s.stage_number));
            avgKdStage = kdSt.toFixed(2); avgKdaStage = kdaSt.toFixed(2); avgPtsStage = Math.round(tP / stCount).toString();
        }
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
        if (res.ok) showToast('Аналитика отправлена в Discord!', 'success'); else showToast('Ошибка при отправке.', 'error');
    } catch (err) { console.error(err); showToast('Ошибка отправки.', 'error'); }
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
            const player = activePlayers.find(p => p.squad === squad.name && p.role === role);
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
        if (res.ok) showToast('Состав отправлен в Discord!', 'success'); else showToast('Ошибка при отправке.', 'error');
    } catch (err) { console.error(err); showToast('Ошибка отправки.', 'error'); }
}

async function clearAllData() {
    if (!confirm('⚠️ Удалить ВСЮ статистику и посещаемость? Это необратимо.')) return;
    const statusDiv = document.getElementById('photo-status');
    if (statusDiv) statusDiv.innerHTML = 'УДАЛЕНИЕ...';
    try {
        await supabaseClient.from('match_stats').delete().neq('id', 0);
        await supabaseClient.from('attendance').delete().neq('id', 0);
        await supabaseClient.from('players').update({ kd: 0, kda: 0, points: 0 }).neq('id', 0);
        if (statusDiv) statusDiv.innerHTML = 'ВСЁ ОЧИЩЕНО!';
        await loadAllData();
        loadMatchStats();
        loadAttendance();
        showToast('Все данные успешно очищены', 'success');
    } catch (err) { showToast('Ошибка: ' + err.message, 'error'); }
}

loadAllData();
