# Customs Demo

A unified customs document parsing demo that accepts mixed PDFs and Excel files,
normalizes them into a single customs record, and renders one declaration draft UI.

## Run

1. Copy `.env.example` to `.env` and fill `DASHSCOPE_API_KEY` if you want LLM enrichment.
2. Install dependencies:
   - `npm install`
   - `npm install --prefix server`
   - `npm install --prefix frontend`
3. Start the app with `npm run dev`
4. Open `http://localhost:5173`

## Vercel

- Frontend is deployed as a static Vite build.
- Backend is deployed as a Node serverless function via `api/index.js`.
- Set `DASHSCOPE_API_KEY` in Vercel project environment variables.
- Local sample packets that read from `~/Downloads` are only available on your machine and will not work on Vercel.
- The deployed site should use uploaded files instead of local sample packet buttons.

## Demo capabilities

- Upload mixed files or load local sample packets
- Auto classify invoice / packing list / cargo manifest / declaration reference
- Parse PDFs and Excel files into structured fields and goods line items
- Merge multi-document candidates into a single `customs_normalized_record`
- Resolve open issues with candidate selection or manual entry
- Render one unified declaration draft and a fake submission page
