require('dotenv').config();
const fs = require('fs');

async function testApi(modelName, imagePath) {
    const apiKey = process.env.VERTEX_API_KEY;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const base64 = fs.readFileSync(imagePath).toString('base64');

    const parts = [
        { inlineData: { mimeType: "image/png", data: base64 } },
        { text: "Describe this image" }
    ];

    const payload = { contents: [{ role: "user", parts }] };

    console.log(`\nTesting ${modelName} with ${imagePath} ... (${Math.round(base64.length / 1024)} KB)`);
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });

    const data = await res.json();
    console.log("Status:", res.status);
    if (data.error) console.log("Error:", data.error.message);
    else console.log("Success with model", modelName);
}

testApi('gemini-3-pro-image-preview', 'FreeFire_Quan/Male/Male_2.png');
