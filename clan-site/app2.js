function initDragAndDrop() {
    const board = document.getElementById('roster-board');
    board.innerHTML = '';
    SQUADS_CONFIG.forEach(squad => {
        const card = document.createElement('div'); card.className = 'squad-card';
        let rolesHtml = '';
        squad.roles.forEach(role => {
            const assigned = allPlayers.find(p => p.squad === squad.name && p.role === role);
            const name = assigned ? assigned.nickname : 'Свободно';
            const cls = assigned ? 'player-name' : 'empty-slot';
            const pid = assigned ? assigned.id : '';
            rolesHtml += `<div class="role-slot" data-squad="${squad.name}" data-role="${role}" data-player-id="${pid}" ondragover="event.preventDefault(); this.classList.add('drag-over')" ondragleave="this.classList.remove('drag-over')" ondrop="handleDrop(event, this)"><span>${role}</span><span class="${cls}">${name}</span></div>`;
        });
        card.innerHTML = `<div class="squad-title">${squad.name}</div>${rolesHtml}`;
        board.appendChild(card);
    });
    const freeList = document.getElementById('free-players-list'); freeList.innerHTML = '';
    const free = allPlayers.filter(p => !p.squad);
    if (free.length === 0) freeList.innerHTML = '<div style="text-align:center; color:#555;">Все распределены</div>';
    else free.forEach(p => {
        const item = document.createElement('div'); item.className = 'free-player-item'; item.draggable = true;
        item.ondragstart = (e) => { e.dataTransfer.setData('text/plain', p.id); item.classList.add('dragging'); };
        item.ondragend = () => item.classList.remove('dragging');
        item.innerHTML = `<span>${p.nickname}</span>`;
        freeList.appendChild(item);
    });
}

async function handleDrop(event, slot) {
    event.preventDefault(); slot.classList.remove('drag-over');
    const pid = event.dataTransfer.getData('text/plain');
    const squad = slot.dataset.squad; const role = slot.dataset.role;
    const existing = slot.dataset.playerId;
    if (!pid) return;
    if (existing) await supabaseClient.from('players').update({ squad: null, role: null }).eq('id', existing);
    const { error } = await supabaseClient.from('players').update({ squad: squad, role: role }).eq('id', pid);
    if (!error) { const { data } = await supabaseClient.from('players').select('*'); if (data) allPlayers = data; initDragAndDrop(); }
}

async function loadFines() {
    const { data } = await supabaseClient.from('fines').select('*, players(nickname)').order('created_at', { ascending: false });
    if (data) { allFines = data; renderFinesTable(); }
}

function renderFinesTable() {
    const tbody = document.getElementById('fines-table-body');
    tbody.innerHTML = allFines.length === 0 ? '<tr><td colspan="5" style="text-align:center;">Нет штрафов</td></tr>' : '';
    allFines.forEach(f => {
        const statusClass = f.status === 'open' ? 'status-open' : 'status-closed';
        const statusText = f.status === 'open' ? 'Открыт' : 'Закрыт';
        const btnText = f.status === 'open' ? '✅ Закрыть' : '🔄 Открыть';
        tbody.innerHTML += `<tr><td><strong>${f.players?.nickname || 'Неизвестный'}</strong></td><td>${f.reason}</td><td style="color:#cf6679;">${f.amount} ₽</td><td class="${statusClass}">${statusText}</td><td><button class="btn" onclick="toggleFineStatus(${f.id}, '${f.status}')">${btnText}</button><button class="btn btn-danger" onclick="deleteFine(${f.id})">🗑️</button></td></tr>`;
    });
}

async function addFine() {
    const pid = document.getElementById('fine-player').value;
    const reason = document.getElementById('fine-reason').value.trim();
    const amount = parseInt(document.getElementById('fine-amount').value) || 0;
    if (!pid || !reason) return alert('Выберите игрока и укажите причину');
    const { error } = await supabaseClient.from('fines').insert([{ player_id: pid, reason: reason, amount: amount, status: 'open' }]);
    if (error) alert('Ошибка: ' + error.message);
    else { document.getElementById('fine-reason').value = ''; document.getElementById('fine-amount').value = ''; loadFines(); }
}

async function toggleFineStatus(id, currentStatus) {
    const newStatus = currentStatus === 'open' ? 'closed' : 'open';
    await supabaseClient.from('fines').update({ status: newStatus }).eq('id', id);
    loadFines();
}

async function deleteFine(id) {
    if (!confirm('Удалить штраф?')) return;
    await supabaseClient.from('fines').delete().eq('id', id);
    loadFines();
}

async function loadAttendance() {
    const { data: players } = await supabaseClient.from('players').select('*');
    const { data: attendance } = await supabaseClient.from('attendance').select('*');
    
    if (players) allPlayers = players;
    if (attendance) allAttendance = attendance;

    const tbody = document.getElementById('attendance-table-body');
    tbody.innerHTML = '';

    allPlayers.forEach(p => {
        let row = `<tr><td>${p.nickname}</td>`;
        for (let t = 1; t <= 12; t++) {
            const record = allAttendance.find(a => a.player_id === p.id && a.tournament_number === t);
            const status = record ? record.status : 'Не отмечен';
            
            let colorClass = '';
            if (status === 'Пришел') colorClass = 'status-1';
            else if (status === 'Не пришел') colorClass = 'status-2';
            else if (status === 'Отгул') colorClass = 'status-3';

            row += `<td>
                <select class="${colorClass}" onchange="updateAttendance(${p.id}, ${t}, this.value)">
                    <option value="Не отмечен" ${status === 'Не отмечен' ? 'selected' : ''}>-</option>
                    <option value="Пришел" ${status === 'Пришел' ? 'selected' : ''}>Пришел</option>
                    <option value="Не пришел" ${status === 'Не пришел' ? 'selected' : ''}>Не пришел</option>
                    <option value="Отгул" ${status === 'Отгул' ? 'selected' : ''}>Отгул</option>
                </select>
            </td>`;
        }
        row += `</tr>`;
        tbody.innerHTML += row;
    });
}

async function updateAttendance(playerId, tournament, status) {
    if (status === 'Не отмечен') {
        await supabaseClient.from('attendance').delete().eq('player_id', playerId).eq('tournament_number', tournament);
    } else {
        await supabaseClient.from('attendance').upsert({
            player_id: playerId,
            tournament_number: tournament,
            status: status
        }, { onConflict: 'player_id, tournament_number' });
    }
    loadAttendance();
}