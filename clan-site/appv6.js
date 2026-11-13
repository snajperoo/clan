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
            
            // ⚡ ИСПОЛЬЗУЕМ АКТУАЛЬНУЮ МОДЕЛЬ gemini-2.0-flash
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
