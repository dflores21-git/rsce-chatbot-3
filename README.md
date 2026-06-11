# RSCE Chatbot

An intelligent FAQ chatbot for the RSCE website to provide easier communication and support to visitors.

## Features
- Answers frequently asked questions automatically
- Pattern matching for natural language understanding
- Easy to update FAQ database
- Lightweight and fast

## Getting Started

### Prerequisites
- Node.js (v14 or higher)
- npm

### Installation

1. Clone the repository:
```bash
git clone https://github.com/jadeeteli-rsce/rsce-chatbot.git
cd rsce-chatbot
```

2. Install dependencies:
```bash
npm install
```

3. Start the server:
```bash
node server.js
```

4. Open `index.html` in your browser (or serve it with a static server)

## Project Structure

```
rsce-chatbot/
├── server.js           # Backend API
├── faqs.json          # FAQ database
├── index.html         # Frontend chatbot UI
├── package.json       # Dependencies
└── README.md          # This file
```

## Customization

### Adding FAQs

Edit `faqs.json` to add new questions and answers:

```json
{
  "id": 5,
  "question": "Your question here?",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "answer": "Your answer here."
}
```

## Deployment

This chatbot can be deployed to:
- **Heroku** (free tier available)
- **Vercel** (for frontend)
- **Railway** (backend hosting)
- **Your own server**

## Contributing

Feel free to improve the FAQ database and add new features!

## License

MIT
