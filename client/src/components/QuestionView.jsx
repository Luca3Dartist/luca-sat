import { useEffect, useState } from 'react';
import { Box, Stack, Paper, Typography, Avatar, TextField, Button, Alert, Chip, Divider, ButtonBase, IconButton, Tooltip, alpha } from '@mui/material';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import UndoIcon from '@mui/icons-material/Undo';
import MrAiIcon from '@mui/icons-material/SentimentSatisfiedAlt';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import DoneIcon from '@mui/icons-material/Done';

export const htmlSx = {
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 17,
  lineHeight: 1.6,
  '& p': { my: 1 },
  '& img': { maxWidth: '100%', height: 'auto', verticalAlign: 'middle', bgcolor: '#fff', borderRadius: 0.5 },
  '& p.fig, & p.mathimg': { my: 1.5 },
  '& p.eq': { textAlign: 'center', my: 1.5 },
  '& sup, & sub': { fontSize: '0.7em', lineHeight: 0 },
  '& table': { borderCollapse: 'collapse', my: 1.5, mx: 'auto' },
  '& td, & th': { border: '1px solid', borderColor: 'grey.500', px: 1, py: 0.5, textAlign: 'center' },
  '& ul': { pl: 3 },
  '& math': { fontSize: '1.05em' },
  '& .sr-only': { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' },
};

export function fixMathml(html) {
  if (!html || !html.includes('mfenced')) return html || '';
  const stack = [];
  return html.replace(/<mfenced([^>]*)>|<\/mfenced>/g, (tag, attrs) => {
    if (tag.startsWith('</')) return `<mo>${stack.pop() ?? ')'}</mo></mrow>`;
    const open = /open="([^"]*)"/.exec(attrs || '')?.[1] ?? '(';
    const close = /close="([^"]*)"/.exec(attrs || '')?.[1] ?? ')';
    stack.push(close);
    return `<mrow><mo>${open}</mo>`;
  });
}

export function Explanation({ html, ai, sx }) {
  if (!html) return null;
  return (
    <Paper variant="outlined" sx={{ p: 2, position: 'relative', ...sx }}>
      {ai && (
        <Tooltip title="Written by Mr AI">
          <Avatar sx={{ position: 'absolute', top: 10, right: 10, width: 30, height: 30, bgcolor: 'secondary.main' }}>
            <MrAiIcon sx={{ fontSize: 20 }} />
          </Avatar>
        </Tooltip>
      )}
      <Typography fontWeight={700} gutterBottom sx={{ pr: ai ? 5 : 0 }}>Explanation</Typography>
      <Html html={html} sx={{ fontFamily: 'inherit', fontSize: 15, '& p': { my: 0.5 } }} />
    </Paper>
  );
}

export function Html({ html, sx }) {
  return <Box sx={{ ...htmlSx, ...sx }} dangerouslySetInnerHTML={{ __html: fixMathml(html) }} />;
}

function Choice({ choice, selected, state, disabled, onClick, crossMode, crossed, onCross }) {
  const tone = state === 'correct' ? 'success' : state === 'wrong' ? 'error' : selected ? 'primary' : null;
  const filled = !!tone;
  return (
    <Stack direction="row" spacing={1} alignItems="center">
      <ButtonBase onClick={onClick} disabled={disabled} sx={{ flexGrow: 1, textAlign: 'left', borderRadius: 2 }}>
        <Paper
          sx={{
            width: '100%',
            p: 1.5,
            border: 2,
            position: 'relative',
            borderColor: tone ? `${tone}.main` : 'divider',
            bgcolor: (t) => (tone ? alpha(t.palette[tone].main, t.palette.mode === 'dark' ? 0.18 : 0.08) : 'background.paper'),
            opacity: crossed ? 0.5 : 1,
            transition: 'all .15s',
            '&:hover': disabled ? {} : { borderColor: tone ? `${tone}.main` : 'primary.light' },
          }}
        >
          {crossed && <Box sx={{ position: 'absolute', left: 8, right: 8, top: '50%', borderTop: 2, borderColor: 'text.primary', pointerEvents: 'none' }} />}
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Avatar sx={{ width: 32, height: 32, fontSize: 15, fontWeight: 700, bgcolor: filled ? `${tone}.main` : 'transparent', color: filled ? `${tone}.contrastText` : 'text.primary', border: filled ? 'none' : '2px solid', borderColor: 'text.secondary', textDecoration: crossed ? 'line-through' : 'none' }}>
              {choice.id}
            </Avatar>
            <Box sx={{ flexGrow: 1 }}>
              <Html html={choice.html} sx={{ '& p': { my: 0 } }} />
            </Box>
            {state === 'correct' && <CheckCircleIcon color="success" />}
            {state === 'wrong' && <CancelIcon color="error" />}
          </Stack>
        </Paper>
      </ButtonBase>
      {crossMode && (
        crossed ? (
          <Button size="small" onClick={onCross} startIcon={<UndoIcon />} sx={{ minWidth: 76 }}>Undo</Button>
        ) : (
          <Tooltip title={`Cross out ${choice.id}`}>
            <span>
              <IconButton onClick={onCross} disabled={disabled} sx={{ width: 76 }}>
                <StrikethroughSIcon />
              </IconButton>
            </span>
          </Tooltip>
        )
      )}
    </Stack>
  );
}

export default function QuestionView({ question, answer, onAnswer, locked, feedback, instant, review, crossMode, crossed = [], onCross }) {
  const [text, setText] = useState(answer ?? '');
  useEffect(() => {
    setText(answer ?? '');
  }, [question.id, answer]);
  const correctList = feedback?.answer || question.correct || null;
  const known = Array.isArray(correctList) && correctList.length > 0;
  const showResult = (locked || review) && known;
  const choiceState = (c) => {
    if (!showResult) return null;
    if (correctList.includes(c.id)) return 'correct';
    if (answer === c.id) return 'wrong';
    return null;
  };
  const twoPane = question.section === 'rw' && question.stimulus_html;
  const answerArea = (
    <Stack spacing={1.2}>
      {question.type === 'mcq' ? (
        question.choices.map((c) => (
          <Choice
            key={c.id}
            choice={c}
            selected={answer === c.id}
            state={choiceState(c)}
            disabled={locked || review}
            crossMode={crossMode && !locked && !review}
            crossed={crossed.includes(c.id) && !review}
            onCross={() => onCross?.(c.id)}
            onClick={() => {
              if (crossed.includes(c.id)) onCross?.(c.id);
              onAnswer?.(c.id, instant);
            }}
          />
        ))
      ) : (
        <Box>
          <Stack direction="row" spacing={1} alignItems="flex-start">
            <TextField
              label="Your answer"
              value={text}
              disabled={locked || review}
              onChange={(e) => {
                setText(e.target.value);
                if (!instant) onAnswer?.(e.target.value, false);
              }}
              inputProps={{ maxLength: 8 }}
              sx={{ maxWidth: 220 }}
              helperText="Numbers, decimals or fractions like 3/4"
            />
            {instant && !locked && !review && (
              <Button variant="contained" startIcon={<DoneIcon />} sx={{ mt: 1 }} disabled={!text.trim()} onClick={() => onAnswer?.(text.trim(), true)}>
                Check
              </Button>
            )}
          </Stack>
          {showResult && (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center">
              {feedbackOk(question, answer, feedback) ? <CheckCircleIcon color="success" /> : <CancelIcon color="error" />}
              <Typography>Correct answer: <b>{correctList.join(' or ')}</b></Typography>
            </Stack>
          )}
        </Box>
      )}
      {(locked || review) && !known && <Alert severity="info">This question has no stored answer, so it is not marked right or wrong.</Alert>}
    </Stack>
  );
  if (twoPane) {
    return (
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} divider={<Divider orientation="vertical" flexItem />}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Html html={question.stimulus_html} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Html html={question.stem_html} sx={{ mb: 2 }} />
          {answerArea}
        </Box>
      </Stack>
    );
  }
  return (
    <Box sx={{ maxWidth: 760, mx: 'auto' }}>
      {question.stimulus_html && <Html html={question.stimulus_html} sx={{ mb: 1 }} />}
      <Html html={question.stem_html} sx={{ mb: 2 }} />
      {answerArea}
    </Box>
  );
}

function feedbackOk(question, answer, feedback) {
  if (feedback && feedback.correct !== undefined && feedback.correct !== null) return feedback.correct;
  if (question.isCorrect !== undefined) return question.isCorrect;
  return false;
}

export function DifficultyChip({ d }) {
  if (!d) return null;
  const map = { E: ['Easy', 'success'], M: ['Medium', 'warning'], H: ['Hard', 'error'] };
  const [label, color] = map[d] || [d, 'default'];
  return <Chip size="small" label={label} color={color} variant="outlined" />;
}
