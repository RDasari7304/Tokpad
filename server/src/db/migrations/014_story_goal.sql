-- Storylines are chapters toward the character's big goal: each one records how it moves the character closer.
ALTER TABLE story_arcs ADD COLUMN IF NOT EXISTS goal_step text NOT NULL DEFAULT '';
