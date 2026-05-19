-- §8.4a.21 W9 / UX-fix — surface human gap titles in list-gaps.
-- The Notion Learning Gaps Queue holds the title in the "Gap Title" property;
-- the pipeline already fetches it at S0 but never persisted it to D1, so the
-- v3 player could only show learning_objective sentences as series labels.
--
-- Apply: npx wrangler d1 migrations apply uc3_fundamentals --remote --config worker/wrangler.jsonc

ALTER TABLE pipeline_state ADD COLUMN gap_title TEXT;
