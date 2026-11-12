async function generateBulkCalendar() {
    if (!isAdmin) return;
    
    // Берем кнопку, чтобы менять её состояние (на случай долгой загрузки)
    const btn = document.querySelector('button[onclick="generateBulkCalendar()"]');
    if (btn) { btn.disabled = true; btn.innerText = 'Генерация...'; }

    const startStr = document.getElementById('bulk-start').value;
    const endStr = document.getElementById('bulk-end').value;
    const time = document.getElementById('bulk-time').value;
    const notes = document.getElementById('bulk-notes').value.trim();
    let startTourney = parseInt(document.getElementById('bulk-start-tournament').value) || 1;
    
    if (!startStr || !endStr) {
        if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; }
        return showToast('Укажите начальную и конечную даты', 'error');
    }
    
    const selectedDays = Array.from(document.querySelectorAll('.bulk-day:checked')).map(cb => parseInt(cb.value));
    if (selectedDays.length === 0) {
        if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; }
        return showToast('Выберите хотя бы один день недели', 'error');
    }

    let current = new Date(startStr); 
    const end = new Date(endStr); 
    const events = []; 
    let currentTourney = startTourney;
    
    // Записываем ID текущего сезона (если стоит "Все время", пишем в 1-й)
    const seasonId = (activeSeasonId === 'all' || !activeSeasonId) ? 1 : parseInt(activeSeasonId);

    while (current <= end) {
        if (selectedDays.includes(current.getDay())) {
            const dateStr = `${current.getFullYear()}-${String(current.getMonth()+1).padStart(2,'0')}-${String(current.getDate()).padStart(2,'0')}`;
            
            // Создаем 3 этапа на каждый день
            for (let stageNum = 1; stageNum <= 3; stageNum++) {
                events.push({ 
                    match_date: dateStr, 
                    match_time: time || null, 
                    tournament_number: currentTourney, 
                    stage_number: stageNum, 
                    notes: notes, 
                    season_id: seasonId 
                });
            }
            currentTourney++; 
        }
        current.setDate(current.getDate() + 1);
    }
    
    if (events.length === 0) { 
        if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; }
        return showToast('Нет дат для генерации', 'info'); 
    }
    
    const { error } = await supabaseClient.from('clan_calendar').insert(events);
    
    if (btn) { btn.disabled = false; btn.innerText = 'Сгенерировать'; }
    
    if (error) {
        console.error("Ошибка массовой вставки:", error);
        showToast('Ошибка БД: ' + error.message, 'error');
    } else {
        showToast(`Успешно добавлено ${events.length / 3} турниров!`, 'success');
        document.getElementById('bulk-start').value = ''; 
        document.getElementById('bulk-end').value = ''; 
        loadCalendar(); // Перезагружаем список
    }
}
