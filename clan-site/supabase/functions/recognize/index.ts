import { serve } from "https://deno.land/std@0.168.0/http/server.ts"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  // Обработка CORS (чтобы браузер не блокировал запрос)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 1. Получаем ключ из секретов Supabase
    const apiKey = Deno.env.get('GEMINI_API_KEY')
    if (!apiKey) {
      throw new Error('API Key not found in secrets')
    }

    // 2. Получаем изображение из запроса
    const { image } = await req.json()
    if (!image) {
      throw new Error('No image provided')
    }

    // 3. Отправляем запрос в Google Gemini
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`
    
    const prompt = `
      Ты — ассистент киберспортивной команды. На изображении таблица с результатами игроков.
      Твоя задача: извлечь данные и вернуть СТРОГО валидный JSON без markdown-разметки.
      Формат JSON: {"players": [{"nickname": "Имя", "kills": 10, "deaths": 5, "assists": 2, "points": 150}]}
      Если данных нет, верни {"players": []}.
    `

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: prompt },
            { inline_data: { mime_type: "image/jpeg", data: image } }
          ]
        }]
      })
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Gemini API Error: ${response.status} - ${errorText}`)
    }

    const data = await response.json()
    
    // 4. Достаем текст ответа
    let textResponse = data.candidates?.[0]?.content?.parts?.[0]?.text || '{}'
    
    // Очищаем от возможных markdown-тегов (```json ... ```)
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim()
    
    // 5. Парсим JSON и возвращаем
    const result = JSON.parse(textResponse)

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })

  } catch (error) {
    // Если произошла ошибка, возвращаем её текст, чтобы было видно в консоли
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 400, // Возвращаем 400 вместо 500, чтобы видеть текст ошибки
    })
  }
})