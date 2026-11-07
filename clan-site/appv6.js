const SUPABASE_URL = 'https://rpqiapddvlkdecddczqx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_hDt4D6V24JeooGxNoLN4rQ__YFppVSz'; 
const { createClient } = supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

// ==================== КОНСТАНТЫ РАНГОВ ====================
const TIERS = [
    { name: 'S', min: 2100, win: 7000,  loss: 3000,  winKeys: 30, lossKeys: 15 },
    { name: 'A', min: 2000, win: 4700,  loss: 1800,  winKeys: 25, lossKeys: 10 },
    { name: 'B', min: 1750, win: 3300,  loss: 1200,  winKeys: 20, lossKeys: 7 },
    { name: 'C', min: 1500, win: 2400,  loss: 800,   winKeys: 15, lossKeys: 5 },
    { name: 'D', min: 1250, win: 1750,  loss: 500,   winKeys: 10, lossKeys: 3 },
    { name: 'E', min: 0,    win: 1250,  loss: 250,   winKeys: 5,  lossKeys: 1 }
];

// ==================== ЕДИНЫЙ STATE ====================
const AppState = {
    players: [], activePlayers: [],
    attendance: [], matchStats: [], matches: [], fines: [],
    tournaments: [], seasons: [],
    upcomingMatches: [],
    activeSeason: null, viewingSeason: null,
};

let currentEditId = null, isAdmin = false;
let currentPhotoFiles = [];
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

// ... (Ваш массив SQUADS_CONFIG, функции getLocalDateString, showToast, initSearchableSelect, isViewingActive, canEdit остаются без изменений) ...
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

// ... (Функции loadSeasons, renderSeasonSelector, startNewSeason, refreshTournaments, refreshPlayers, refreshAttendance, refreshMatchStats, refreshMatches, refreshFines, refreshUpcoming, getMaxStage, refreshAll, checkLogin, logout, openTab, goToPlayerProfile, computeSeasonStats, setTopsMode, renderTops, sortTops, populateProfileDropdowns, fillPlayerSelects, renderPlayerList, filterPlayerList, selectPlayer, clearForm, saveProfile, deletePlayer, loadMyProfile, initDragAndDrop, handleDrop, removeFromSquad, loadAttendance, updateAttendance, loadAllMissed, updateMissedStatus, loadMatchStats, updateMatchStat, recalculatePlayerStats, addTournament, deleteTournament, addStage, deleteStage, initCompareTab, getCompareStatsForPeriod, renderComparison, fillEmptyMatch, addMatchHistory, updateMatchData, deleteMatch, renderHistoryChart, loadCalendar, addUpcomingMatch, deleteUpcoming, loadFines, addFine, toggleFineStatus, deleteFine, openPhotoModal, closePhotoModal, saveAbsentStatuses, confirmPhotoUpload, loadAnalytics, sendAnalyticsScreenshot, sendRosterScreenshot, clearAllData, initRealtime, refreshAll().then(initRealtime) остаются без изменений) ...


// ==================== НОВАЯ ЛОГИКА ДЛЯ ИСТОРИИ ====================
function getTierByRating(rating) {
    return TIERS.find(t => rating >= t.min) || TIERS[TIERS.length - 1];
}

async function loadMatchHistory() {
    const timeline = document.getElementById('history-timeline');
    if (!timeline) return;
    timeline.innerHTML = '<div style="text-align:center; width:100%;">Загрузка...</div>';

    renderTournamentMVPs(); 

    const matchesByStage = {};
    AppState.matches.forEach(m => { if (m.stage_number) matchesByStage[m.stage_number] = m; });

    const totalStages = getMaxStage();
    const tCountEl = document.getElementById('history-tournament-count');
    const sCountEl = document.getElementById('history-stage-count');
    if (tCountEl) tCountEl.innerText = Math.ceil(totalStages / STAGES_PER_TOURNAMENT);
    if (sCountEl) sCountEl.innerText = totalStages;

    // ==================== РАСЧЕТ РЕЙТИНГА И ГИЛЬЗ ====================
    const sortedMatches = [...AppState.matches].filter(m => m.stage_number).sort((a, b) => a.stage_number - b.stage_number);
    
    let currentRating = START_RATING;
    let currentTier = getTierByRating(currentRating);
    let totalGears = 0;
    const matchDetails = {}; 
    
    sortedMatches.forEach(m => {
        let ratingChange = 0;
        let gearsEarned = 0;
        const c = m.clan_score || 0;
        const e = m.enemy_points || 0;
        
        // Определяем тир, в котором мы находимся ДО матча
        const tierBeforeMatch = getTierByRating(currentRating);
        
        if (c > e) {
            ratingChange = RATING_CHANGE;
            gearsEarned = tierBeforeMatch.win;
            currentRating += ratingChange;
            // Проверяем, не повысились ли мы в тире после победы
            currentTier = getTierByRating(currentRating);
        } else if (c < e) {
            ratingChange = -RATING_CHANGE;
            gearsEarned = tierBeforeMatch.loss;
            currentRating += ratingChange;
            // Проверяем, не понизились ли мы
            currentTier = getTierByRating(currentRating);
        } else {
            // Ничья - гильзы не дают, рейтинг не меняется
        }
        
        totalGears += gearsEarned;
        matchDetails[m.id] = { ratingChange, gearsEarned, totalRating: currentRating };
    });

    // Обновляем блок сверху
    const ratingEl = document.getElementById('hr-rating');
    if (ratingEl) {
        ratingEl.innerText = currentRating;
        if (currentRating > START_RATING) ratingEl.style.color = 'var(--success-color)';
        else if (currentRating < START_RATING) ratingEl.style.color = 'var(--danger-color)';
        else ratingEl.style.color = 'var(--accent-color)';
    }
    
    const tierEl = document.getElementById('hr-tier');
    if (tierEl) {
        tierEl.innerText = currentTier.name + ' Тир';
        tierEl.style.color = 'var(--accent-color)'; // Или можно задать цвет в зависимости от тира
    }

    const gearsEl = document.getElementById('hr-gears');
    if (gearsEl) gearsEl.innerText = totalGears.toLocaleString('ru-RU');

    // ================================================================

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

            const details = matchDetails[match.id] || { ratingChange: 0, gearsEarned: 0, totalRating: 0 };
            
            const ratingHtml = details.ratingChange !== 0 
                ? `<div style="font-size:0.85em; font-weight:bold; margin-top:5px; color:${details.ratingChange > 0 ? 'var(--success-color)' : 'var(--danger-color)'};">Рейтинг: ${details.ratingChange > 0 ? '+' : ''}${details.ratingChange} (Итого: ${details.totalRating})</div>`
                : '';
            
            // Вывод гильз
            const gearsHtml = details.gearsEarned > 0
                ? `<div style="font-size:0.9em; font-weight:bold; color:#9cdcfe; margin-top:3px;">🪙 Гильзы: +${details.gearsEarned.toLocaleString('ru-RU')}</div>`
                : '';

            // ... (Блок adminEdit остается без изменений) ...
            const adminEdit = canEdit() ? `...` : '';

            timeline.innerHTML += `<div class="timeline-item ${isLeft ? 'left' : 'right'}">
                <div class="timeline-content">
                    <div style="font-size:0.8em; color:var(--accent-color); margin-bottom:5px;">ТУРНИР ${tourneyNum} · ЭТАП ${stageNum}</div>
                    <div class="timeline-date">${dateStr}</div>
                    <div class="timeline-opponent">vs <strong>${opponent}</strong></div>
                    <div class="timeline-score ${scoreClass}">${cScore} : ${eScore}</div>
                    <div style="color:var(--text-muted); font-size:0.9em; margin-top:5px;">${winText}</div>
                    ${ratingHtml}
                    ${gearsHtml}
                    ${adminEdit}
                </div>
            </div>`;
        } else {
           // ... (Блок "Не сыгран" остается без изменений) ...
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

// ==================== ФИЧА №3: УВЕДОМЛЕНИЯ АДМИНУ В DISCORD ====================
async function sendAdminSummaryToDiscord() {
    if (!isAdmin) return;
    
    // 1. Собираем "тренера" (аналитика)
    let totalPlayers = AppState.activePlayers.length;
    let totalMissed = 0;
    let topPlayer = null;
    let maxPts = -1;
    
    // Находим лучшего игрока за последний этап/турнир
    if (AppState.matchStats.length > 0) {
        const lastStage = Math.max(...AppState.matchStats.map(s => s.stage_number));
        const lastStageStats = AppState.matchStats.filter(s => s.stage_number === lastStage);
        lastStageStats.forEach(s => {
            if ((s.points || 0) > maxPts) {
                maxPts = s.points;
                topPlayer = AppState.players.find(p => p.id === s.player_id);
            }
        });
    }
    
    // Считаем прогульщиков
    const misses = AppState.attendance.filter(a => a.status === 'Не пришел');
    const groupedMisses = {};
    misses.forEach(m => {
        if (!groupedMisses[m.player_id]) groupedMisses[m.player_id] = 0;
        groupedMisses[m.player_id]++;
    });
    let worstPlayer = null;
    let worstMissCount = 0;
    for (const [pid, count] of Object.entries(groupedMisses)) {
        if (count > worstMissCount) {
            worstMissCount = count;
            worstPlayer = AppState.players.find(p => p.id === parseInt(pid));
        }
    }

    // 2. Формируем текст сообщения
    let summaryText = `🤖 **СВОДКА ДЛЯ АДМИНА**\n\n`;
    summaryText += `📊 Активных бойцов: ${totalPlayers}\n`;
    summaryText += `🏆 Турниров сыграно: ${AppState.tournaments.length} из ${TOURNAMENTS_PER_SEASON}\n\n`;
    
    if (topPlayer) {
        summaryText += `🔥 **Лучший на последнем этапе:** ${topPlayer.nickname} (${maxPts} очков)\n`;
    }
    
    if (worstPlayer && worstMissCount > 1) {
        summaryText += `⚠️ **Внимание:** ${worstPlayer.nickname} пропустил уже ${worstMissCount} этапов. Пора поговорить!\n`;
    } else {
        summaryText += `✅ С посещаемостью всё отлично, грубых прогулов нет.\n`;
    }
    
    summaryText += `\n📅 Активных записей в календаре: ${AppState.upcomingMatches.length}\n`;
    summaryText += `\n_Отправлено автоматически с портала STALZONE_`;

    // 3. Отправляем вам в личку через Edge Function
    const DISCORD_USER_ID = prompt('Введите ваш Discord ID для получения сводки:', '');
    if (!DISCORD_USER_ID) return;

    try {
        showToast('Отправка сводки...', 'info');
        const res = await fetch('https://rpqiapddvlkdecddczqx.supabase.co/functions/v1/send-to-discord', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                userId: DISCORD_USER_ID, // <--- Отправка в личку
                content: summaryText,
                imageBase64: null,
                deletePrevious: false 
            })
        });
        
        if (res.ok) {
            showToast('Сводка отправлена в Discord!', 'success');
        } else {
            showToast('Ошибка при отправке (проверьте ID)', 'error');
        }
    } catch (err) { 
        console.error(err); 
        showToast('Ошибка сети', 'error'); 
    }
}

// ... (Остальные функции без изменений) ...
