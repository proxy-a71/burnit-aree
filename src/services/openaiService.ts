import { OPENAI_API_KEY } from '../constants';
import { ChatMessage } from '../types';

export const openaiService = {
  async sendMessage(messages: ChatMessage[]) {
    if (!OPENAI_API_KEY) {
        return "Please configure your OpenAI API Key in constants.ts";
    }

    try {
        // Map internal message format to OpenAI format
        const apiMessages = messages.map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.text
        }));

        // Add System Prompt
        apiMessages.unshift({
            role: "system",
            content: "You are Burnit AI! Your Personal Ai For Your Confusing Questions, Giving You Motivation 💪.\n\nFORMATTING RULES:\n1. Use LaTeX for ALL math expressions and formulas. \n   - Inline math: $E=mc^2$\n   - Block math: $$ \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a} $$\n2. Format your response beautifully using Markdown.\n   - Use **Bold** for emphasis.\n   - Use lists (bullets/numbered) for steps.\n   - Use code blocks for code.\n3. Keep responses concise but helpful.\n\nYou are helpful, friendly, and knowledgeable."
        });

        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${OPENAI_API_KEY}`
            },
            body: JSON.stringify({
                model: "gpt-4o",
                messages: apiMessages,
                temperature: 0.7,
                max_tokens: 1000
            })
        });

        const data = await response.json();
        
        if (data.error) {
            console.error("OpenAI Error:", data.error);
            return `Error: ${data.error.message}`;
        }

        return data.choices?.[0]?.message?.content || "No response received.";
    } catch (error: any) {
        console.error("OpenAI Service Error:", error);
        return `Connection Error: ${error.message}`;
    }
  }
};
