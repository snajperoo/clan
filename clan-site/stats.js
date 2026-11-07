let allMatchStats = [];
let maxStage = 3;

// ==========================================
// ЗАГРУЗКА СТАТИСТИКИ
// ==========================================
async function loadMatchStats() {
    const { data: players } = await supabaseClient.from('players').select('*');
    const { data: stats } = await supabaseClient.from('match_stats').select('*');
    
    if (players) {
        allPlayers = players;
        activePlayers = players.filter(p => !p.status || p.status === 'в клане');
    }
    if (stats) allMatchStats = stats;

    let max = 0;
    if (allMatchStats.length > 0) {
        max = Math.max(...allMatchStats.map(s => s.stage_number));
    }
    if (max < 3) {
        max = 3;
    }
    
    maxStage = max;
    renderStatsTable();
}

// ==========================================
// ОТРИСОВКА ТАБЛИЦЫ СТАТИСТИКИ
// ==========================================
function renderStatsTable() {
    const thead = document.getElementById('stats-thead');
    const tbody = document.getElementById('stats-tbody');
    
    // 1. Строим заголовок с группировкой по турнирам
    let headerHtml = '<tr class="day-brackets-row"><th rowspan="2" style="vertical-align: middle; background: var(--card-bg);">Игрок</th>';
    const tournamentsCount = Math.ceil(maxStage / 3);
    
    for (let t = 0; t < tournamentsCount; t++) {
        const stagesInThisTournament = Math.min(3, maxStage - t * 3);
        const colspanValue = stagesInThisTournament * 4;
        headerHtml += `<th colspan="${colspanValue}" style="border: 2px solid var(--accent-color); border-bottom: none; border-radius: 10px 10px 0 0; color: var(--accent-color); font-weight: bold; text-align: center; background: var(--panel-bg);">📅 Турнир ${t + 1}</th>`;
    }
    headerHtml += '<th rowspan="2" style="vertical-align: middle; background:#2c2c2c; color:#03dac6;">Сумма очков</th></tr><tr>';
    
    // 2. Второй ряд заголовка — сами этапы
    for (let i = 1; i <= maxStage; i++) {
        let borderStyle = '';
        if (i === 1 || (i - 1) % 3 === 0) borderStyle = 'border-left: 2px solid var(--accent-color);'; 
        headerHtml += `<th colspan="4" style="background:#2c2c2c; color:#bb86fc; ${borderStyle}">Этап ${i}</th>`;
    }
    headerHtml += '</tr><tr>';
    
    // 3. Третий ряд заголовка — буквы K, D, A, Pts
    for (let i = 1; i <= maxStage; i++) {
        let borderStyle = '';
        if (i === 1 || (i - 1) % 3 === 0) borderStyle = 'border-left: 2px solid var(--accent-color);';
        headerHtml += `<th style="${borderStyle}">K</th><th>D</th><th>A</th><th>Pts</th>`;
    }
    headerHtml += '</tr>';
    thead.innerHTML = headerHtml;

    // 4. Отрисовка строк с игроками
    tbody.innerHTML = '';
    const playersToShow = (typeof activePlayers !== 'undefined' && activePlayers.length > 0) ? activePlayers : allPlayers;

    playersToShow.forEach(p => {
        let row = `<tr><td>${p.nickname}</td>`;
        let totalPoints = 0;
        
        for (let i = 1; i <= maxStage; i++) {
            const rec = allMatchStats.find(s => s.player_id === p.id && s.stage_number === i);
            const k = rec ? rec.kills : '';
            const d = rec ? rec.deaths : '';
            const a = rec ? rec.assists : '';
            const pts = rec ? rec.points : '';
            
            if (rec) totalPoints += rec.points;
            
            let borderStyle = '';
            if (i === 1 || (i - 1) % 3 === 0) borderStyle = 'border-left: 2px solid var(--accent-color);';

            row += `<td style="${borderStyle}"><input type="number" value="${k}" onchange="updateStat(${p.id}, ${i}, 'kills', this.value)"></td>`;
            row += `<td><input type="number" value="${d}" onchange="updateStat(${p.id}, ${i}, 'deaths', this.value)"></td>`;
            row += `<td><input type="number" value="${a}" onchange="updateStat(${p.id}, ${i}, 'assists', this.value)"></td>`;
            row += `<td><input type="number" value="${pts}" onchange="updateStat(${p.id}, ${i}, 'points', this.value)"></td>`;
        }
        row += `<td style="color:#03dac6; font-weight:bold;">${totalPoints}</td></tr>`;
        tbody.innerHTML += row;
    });
}

// ==========================================
// РУЧНОЙ ВВОД (С АВТОПЕРЕСЧЕТОМ)
// ==========================================
async function updateStat(playerId, stage, field, value) {
    const numValue = parseInt(value) || 0;
    const existing = allMatchStats.find(s => s.player_id === playerId && s.stage_number === stage);
    
    if (existing) {
        const updateData = {};
        updateData[field] = numValue;
        await supabaseClient.from('match_stats').update(updateData).eq('id', existing.id);
    } else {
        const insertData = { player_id: playerId, stage_number: stage, kills: 0, deaths: 0, assists: 0, points: 0 };
        insertData[field] = numValue;
        await supabaseClient.from('match_stats').insert([insertData]);
    }
    
    await recalculatePlayerStats(playerId);
    
    const { data: freshStats } = await supabaseClient.from('match_stats').select('*');
    if (freshStats) allMatchStats = freshStats;

    renderStatsTable();

    await loadAllData(); 
    
    if (document.getElementById('tab-analytics').classList.contains('active')) {
        loadAnalytics();
    }
}

// ==========================================
// ПЕРЕСЧЕТ КД, КДА И ОЧКОВ
// ==========================================
async function recalculatePlayerStats(playerId) {
    const { data: stats, error } = await supabaseClient
        .from('match_stats')
        .select('*')
        .eq('player_id', playerId);
        
    if (error || !stats) return;

    let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalPoints = 0;
    stats.forEach(s => {
        totalKills += s.kills || 0;
        totalDeaths += s.deaths || 0;
        totalAssists += s.assists || 0;
        totalPoints += s.points || 0;
    });

    let kd = totalDeaths === 0 ? totalKills : (totalKills / totalDeaths);
    let kda = totalDeaths === 0 ? (totalKills + totalAssists) : ((totalKills + totalAssists) / totalDeaths);

    kd = Math.round(kd * 100) / 100;
    kda = Math.round(kda * 100) / 100;

    await supabaseClient.from('players').update({
        kd: kd,
        kda: kda,
        points: totalPoints
    }).eq('id', playerId);
}

// ==========================================
// ДОБАВЛЕНИЕ И УДАЛЕНИЕ ТУРНИРА (3 ЭТАПА)
// ==========================================
async function addStage() {
    maxStage += 3;
    renderStatsTable();
}

async function deleteStage() {
    if (maxStage <= 3) return alert('Нельзя удалить последний турнир');
    if (!confirm(`Удалить последний турнир (этапы ${maxStage-2}, ${maxStage-1}, ${maxStage})?`)) return;

    for (let i = maxStage; i > maxStage - 3; i--) {
        await supabaseClient.from('match_stats').delete().eq('stage_number', i);
    }
    
    for (const p of allPlayers) {
        await recalculatePlayerStats(p.id);
    }
    
    maxStage -= 3;
    loadMatchStats();
    if (document.getElementById('tab-tops').classList.contains('active') || document.getElementById('tab-analytics').classList.contains('active')) {
        await loadAllData();
        if (document.getElementById('tab-analytics').classList.contains('active')) loadAnalytics();
    }
}