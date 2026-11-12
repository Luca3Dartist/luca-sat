# Luca's SAT

Practice the digital SAT with your colleagues: generated tests from the College Board question bank, imported PDF practice tests, timers, breaks, Desmos, instant feedback, scores and an AI tutor.

## Run it

Requires Node 20 or newer.

    npm run setup
    npm start

Open http://localhost:3001. The first account you create becomes an admin. Set `PORT` to use another port.

For development with hot reload, run `npm run dev:server` and `npm run dev:client`, then open http://localhost:5173.

## Where things live

- `server/` Express API, SQLite database in `server/data/sat.db`, cropped PDF figures in `server/data/images/`
- `server/src/pdf.js` SAT PDF parser
- `server/src/jobs.js` College Board bank download and AI answer generation
- `client/` React app built with Material UI

## First steps for an admin

1. Admin, AI keys: paste a default Anthropic API key and pick a model. Add access words (for example `ultraLearn!`) linked to other keys or models.
2. Admin, Question bank: press Fetch all questions to download the College Board bank.
3. After importing PDFs, press Generate answers so imported questions get answers and categories.
