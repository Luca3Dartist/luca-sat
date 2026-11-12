import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Stack, Typography, Paper, Grid, Box, Chip, LinearProgress, Accordion, AccordionSummary, AccordionDetails, Button, Alert, Skeleton, ToggleButtonGroup, ToggleButton, CircularProgress, Tooltip } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import MrAiIcon from '@mui/icons-material/SentimentSatisfiedAlt';
import RefreshIcon from '@mui/icons-material/Refresh';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import CalculateIcon from '@mui/icons-material/Calculate';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import { api, formatDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import QuestionView, { DifficultyChip, Explanation } from '../components/QuestionView.jsx';
import AiChat from '../components/AiChat.jsx';
import ShareCode from '../components/ShareCode.jsx';
import GroupsIcon from '@mui/icons-material/Groups';

function ScoreCard({ icon, label, value, sub, color }) {
  return (
    <Paper sx={{ p: 3, textAlign: 'center', height: '100%' }}>
      <Box sx={{ color: `${color}.main` }}>{icon}</Box>
      <Typography color="text.secondary">{label}</Typography>
      <Typography variant="h3" fontWeight={800}>{value ?? '-'}</Typography>
      {sub && <Typography variant="body2" color="text.secondary">{sub}</Typography>}
    </Paper>
  );
}

function StudyPlan({ testId, initial }) {
  const [plan, setPlan] = useState(initial || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const load = async (refresh) => {
    setBusy(true);
    setError('');
    try {
      setPlan((await api.post(`/api/tests/${testId}/study-plan`, { refresh })).plan);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!initial) load(false);
  }, []);
  return (
    <Paper sx={{ p: 3 }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <MrAiIcon color="secondary" />
        <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>Mr AI says: learn this next</Typography>
        <Tooltip title="Write a new plan">
          <span>
            <Button size="small" startIcon={<RefreshIcon />} onClick={() => load(true)} disabled={busy}>Refresh</Button>
          </span>
        </Tooltip>
      </Stack>
      {busy && (
        <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
          <CircularProgress size={18} />
          <Typography>Mr AI is looking at your mistakes...</Typography>
        </Stack>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      {!busy && plan && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{plan}</Typography>}
    </Paper>
  );
}

export default function ResultsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [test, setTest] = useState(null);
  const [filter, setFilter] = useState('wrong');
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/api/tests/${id}`).then((t) => {
      if (t.status !== 'finished') navigate(`/test/${id}`, { replace: true });
      else setTest(t);
    }).catch((e) => setError(e.message));
  }, [id]);

  const rows = useMemo(() => {
    if (!test) return [];
    const out = [];
    for (const s of test.stages) {
      if (s.kind !== 'module') continue;
      s.questions.forEach((q, i) => out.push({ q, stage: s, number: i + 1, answer: test.state.answers[q.id] }));
    }
    return out;
  }, [test]);

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!test) return <Skeleton variant="rounded" height={400} />;
  const r = test.result;
  const wrongCount = rows.filter((x) => x.q.isCorrect === false).length;
  const visible = rows.filter((x) => (filter === 'all' ? true : filter === 'wrong' ? x.q.isCorrect === false : x.q.isCorrect === null || x.q.isCorrect === undefined));
  const weak = r.categories.filter((c) => c.total > 0 && c.correct / c.total < 0.7).slice(0, 5);
  const aiOn = user.ai?.enabled;

  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={2}>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sats')}>SATs</Button>
        <Box>
          <Stack direction="row" spacing={2} alignItems="center">
            <Typography variant="h4" fontWeight={700}>{test.title}</Typography>
            <ShareCode code={test.shareCode} size="medium" />
            <Button variant="outlined" color="secondary" startIcon={<GroupsIcon />} onClick={() => navigate(`/takers/${test.id}`)}>Who else took it</Button>
          </Stack>
          <Typography color="text.secondary">Finished {formatDate(test.finishedAt)}</Typography>
        </Box>
      </Stack>

      <Grid container spacing={2}>
        <Grid item xs={12} md={4}>
          <ScoreCard icon={<EmojiEventsIcon fontSize="large" />} color="primary" label={r.scores.projected ? 'Projected total score' : 'Total score'} value={r.scores.total} sub="400 to 1600" />
        </Grid>
        <Grid item xs={12} md={4}>
          <ScoreCard icon={<MenuBookIcon fontSize="large" />} color="secondary" label="Reading and Writing" value={r.scores.rw} sub={r.sections.rw.total ? `${r.sections.rw.correct} of ${r.sections.rw.scorable} correct` : 'Not taken'} />
        </Grid>
        <Grid item xs={12} md={4}>
          <ScoreCard icon={<CalculateIcon fontSize="large" />} color="success" label="Math" value={r.scores.math} sub={r.sections.math.total ? `${r.sections.math.correct} of ${r.sections.math.scorable} correct` : 'Not taken'} />
        </Grid>
      </Grid>
      {(r.sections.rw.total > r.sections.rw.scorable || r.sections.math.total > r.sections.math.scorable) && (
        <Alert severity="info">Some questions have no stored answer yet, so they are not counted in the score. An admin can generate answers for them.</Alert>
      )}

      <Grid container spacing={2}>
        <Grid item xs={12} md={aiOn ? 6 : 12}>
          <Paper sx={{ p: 3, height: '100%' }}>
            <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
              <TrendingDownIcon color="error" />
              <Typography variant="h6" fontWeight={700}>Categories</Typography>
            </Stack>
            {weak.length > 0 && (
              <Box sx={{ mb: 2 }}>
                <Typography variant="body2" color="text.secondary" gutterBottom>You do not know these well yet:</Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  {weak.map((c) => <Chip key={c.domain + c.skill} color="error" variant="outlined" label={c.skill} />)}
                </Stack>
              </Box>
            )}
            <Stack spacing={1.5}>
              {r.categories.map((c) => {
                const pct = Math.round((100 * c.correct) / c.total);
                return (
                  <Box key={c.section + c.domain + c.skill}>
                    <Stack direction="row" justifyContent="space-between">
                      <Typography variant="body2" fontWeight={600}>{c.skill}</Typography>
                      <Typography variant="body2" color="text.secondary">{c.correct}/{c.total}</Typography>
                    </Stack>
                    <Typography variant="caption" color="text.secondary">{c.domain}</Typography>
                    <LinearProgress variant="determinate" value={pct} color={pct >= 80 ? 'success' : pct >= 50 ? 'warning' : 'error'} sx={{ height: 8, borderRadius: 4 }} />
                  </Box>
                );
              })}
              {r.categories.length === 0 && <Typography color="text.secondary">No categorized questions in this test.</Typography>}
            </Stack>
          </Paper>
        </Grid>
        {aiOn && (
          <Grid item xs={12} md={6}>
            <StudyPlan testId={test.id} initial={test.studyPlan} />
          </Grid>
        )}
      </Grid>

      <Paper sx={{ p: 3 }}>
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={2} sx={{ mb: 2 }}>
          <Typography variant="h6" fontWeight={700}>Questions</Typography>
          <ToggleButtonGroup size="small" exclusive value={filter} onChange={(e, v) => v && setFilter(v)}>
            <ToggleButton value="wrong">Wrong ({wrongCount})</ToggleButton>
            <ToggleButton value="unscored">Unscored</ToggleButton>
            <ToggleButton value="all">All ({rows.length})</ToggleButton>
          </ToggleButtonGroup>
        </Stack>
        {visible.length === 0 && <Alert severity="success">Nothing to show here.</Alert>}
        {visible.map(({ q, stage, number, answer }) => (
          <Accordion key={q.id} disableGutters TransitionProps={{ unmountOnExit: true }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
                {q.isCorrect === true ? <CheckCircleIcon color="success" /> : q.isCorrect === false ? <CancelIcon color="error" /> : <HelpOutlineIcon color="disabled" />}
                <Typography fontWeight={600}>{stage.title}, question {number}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                  Your answer: {answer ?? 'none'}{q.correct ? ` - correct: ${q.correct.join(' or ')}` : ''}
                </Typography>
                {q.skill && <Chip size="small" label={q.skill} />}
                <DifficultyChip d={q.difficulty} />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={2}>
                <QuestionView question={q} answer={answer} review />
                <Explanation html={q.rationale_html} ai={q.explanationAi} />
                {aiOn && q.isCorrect === false && <AiChat testId={test.id} questionId={q.id} autoStart={false} />}
              </Stack>
            </AccordionDetails>
          </Accordion>
        ))}
      </Paper>
    </Stack>
  );
}
