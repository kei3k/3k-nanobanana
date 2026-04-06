require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const fs = require('fs');

async function testSdk(modelName, imagePath) {
    const ai = new GoogleGenAI({ apiKey: process.env.VERTEX_API_KEY });
    const base64 = fs.readFileSync(imagePath).toString('base64');
    const parts = [
        { text: "Describe this image" },
        { inlineData: { mimeType: "image/png", data: base64 } }
    ];

    console.log(`\nTesting SDK ${modelName} with ${imagePath} ...`);
    try {
        const response = await ai.models.generateContent({
            model: modelName,
            contents: [{ role: 'user', parts }]
        });
        console.log("Success:", response.text.slice(0, 50));
    } catch(e) {
        console.error("SDK Error:", e.message);
    }
}
testSdk('gemini-3-pro-image-preview', 'FreeFire_Quan/Male/Male_3.png');
