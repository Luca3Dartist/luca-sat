import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Stack, Typography, Paper, Button, Table, TableHead, TableRow, TableCell, TableBody, Chip, LinearProgress, Alert, Skeleton, Dialog, DialogTitle, DialogContent, DialogActions, Accordion, AccordionSummary, AccordionDetails, Box, ToggleButtonGroup, ToggleButton, IconButton, Tooltip, TableContainer } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import GroupsIcon from '@mui/icons-material/Groups';
import VisibilityIcon from '@mui/icons-material/Visibility';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import RefreshIcon from '@mui/icons-material/Refresh';
import { api, formatDate } from '../api.js';
import ShareCode from '../components/ShareCode.jsx';
import QuestionView, { DifficultyChip, Explanation } from '../components/QuestionView.jsx';

function TakerDialog({ testId, taker, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  useEffect(() => {
    if (!taker) return;
    setData(null);
    setError('');
    api.get(`/api/tests/${testId}/takers/${taker.id}`).then(setData).catch((e) => setError(e.message));
  }, [taker, testId]);
  const rows = useMemo(() => {
    if (!data) return [];
    const out = [];
    for (const s of data.stages) {
      if (s.kind !== 'module') continue;
      s.questions.forEach((q, i) => out.push({ q, stage: s, number: i + 1, answer: data.answers[q.id] }));
    }
    return out;
  }, [data]);
  const visible = rows.filter((r) => (filter === 'wrong' ? r.q.isCorrect === false : filter === 'right' ? r.q.isCorrect === true : true));
  return (
    <Dialog open={!!taker} onClose={onClose} fullWidth maxWidth="lg">
      <DialogTitle fontWeight={700}>{taker?.username}'s answers</DialogTitle>
      <DialogContent>
        {error && <Alert severity="error">{error}</Alert>}
        {!data && !error && <LinearProgress />}
        {data && (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <Chip label={data.status === 'finished' ? `Finished ${formatDate(data.finishedAt)}` : `In progress, last active ${formatDate(data.updatedAt)}`} color={data.status === 'finished' ? 'success' : 'warning'} variant="outlined" />
              {data.result && <Chip color="primary" label={`${data.result.scores.total}${data.result.scores.projected ? ' projected' : ''}`} />}
              {data.result?.scores.rw != null && <Chip variant="outlined" label={`R&W ${data.result.scores.rw}`} />}
              {data.result?.scores.math != null && <Chip variant="outlined" label={`Math ${data.result.scores.math}`} />}
              <Box sx={{ flexGrow: 1 }} />
              <ToggleButtonGroup size="small" exclusive value={filter} onChange={(e, v) => v && setFilter(v)}>
                <ToggleButton value="all">All ({rows.length})</ToggleButton>
                <ToggleButton value="wrong">Wrong ({rows.filter((r) => r.q.isCorrect === false).length})</ToggleButton>
                <ToggleButton value="right">Right ({rows.filter((r) => r.q.isCorrect === true).length})</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
            <Box>
              {visible.map(({ q, stage, number, answer }) => (
                <Accordion key={q.id} disableGutters TransitionProps={{ unmountOnExit: true }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ width: '100%' }}>
                      {q.isCorrect === true ? <CheckCircleIcon color="success" /> : q.isCorrect === false ? <CancelIcon color="error" /> : <HelpOutlineIcon color="disabled" />}
                      <Typography fontWeight={600}>{stage.title}, question {number}</Typography>
                      <Typography variant="body2" color="text.secondary" sx={{ flexGrow: 1 }}>
                        Answer: {answer ?? 'none'}{q.correct ? ` - correct: ${q.correct.join(' or ')}` : ''}
                      </Typography>
                      {q.skill && <Chip size="small" label={q.skill} />}
                      <DifficultyChip d={q.difficulty} />
                    </Stack>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={2}>
                      <QuestionView question={q} answer={answer} review />
                      <Explanation html={q.rationale_html} ai={q.explanationAi} />
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              ))}
            </Box>
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

export default function TakersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);
  const load = () => api.get(`/api/tests/${id}/takers`).then(setData).catch((e) => setError(e.message));
  useEffect(() => {
    load();
  }, [id]);
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Skeleton variant="rounded" height={400} />;
  const finished = data.takers.filter((t) => t.status === 'finished');
  const avg = finished.length && finished.every((t) => t.scores) ? Math.round(finished.reduce((n, t) => n + t.scores.total, 0) / finished.length) : null;
  return (
    <Stack spacing={3}>
      <Stack direction="row" alignItems="center" spacing={2} flexWrap="wrap" useFlexGap>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate('/sats')}>SATs</Button>
        <Typography variant="h4" fontWeight={700}>{data.test.title}</Typography>
        <ShareCode code={data.test.shareCode} size="medium" />
        <Box sx={{ flexGrow: 1 }} />
        <Tooltip title="Refresh">
          <IconButton onClick={load}>
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Stack>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <GroupsIcon color="primary" />
          <Typography variant="h6" fontWeight={700} sx={{ flexGrow: 1 }}>People who took your test</Typography>
          {avg !== null && <Chip color="primary" variant="outlined" label={`Average ${avg}`} />}
        </Stack>
        {data.takers.length === 0 ? (
          <Alert severity="info">Nobody has used the code {data.test.shareCode} yet. Share it and their scores and answers will show up here.</Alert>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell>Score</TableCell>
                  <TableCell>Correct</TableCell>
                  <TableCell>Last active</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {data.takers.map((t) => (
                  <TableRow key={t.id} hover>
                    <TableCell>
                      <Typography fontWeight={600}>{t.username}</Typography>
                      {!t.direct && t.viaCode && <Typography variant="caption" color="text.secondary">Got it from code {t.viaCode}</Typography>}
                    </TableCell>
                    <TableCell>
                      {t.status === 'finished' ? (
                        <Chip size="small" color="success" label="Finished" />
                      ) : (
                        <Stack spacing={0.5} sx={{ minWidth: 120 }}>
                          <Chip size="small" color="warning" label={`In progress, ${t.answered}/${t.questions}`} />
                          <LinearProgress variant="determinate" value={(100 * t.answered) / Math.max(1, t.questions)} />
                        </Stack>
                      )}
                    </TableCell>
                    <TableCell>
                      {t.scores ? (
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          <Chip size="small" color="primary" label={`${t.scores.total}${t.scores.projected ? ' projected' : ''}`} />
                          {t.scores.rw != null && <Chip size="small" variant="outlined" label={`R&W ${t.scores.rw}`} />}
                          {t.scores.math != null && <Chip size="small" variant="outlined" label={`Math ${t.scores.math}`} />}
                        </Stack>
                      ) : (
                        <Typography variant="body2" color="text.secondary">Not finished</Typography>
                      )}
                    </TableCell>
                    <TableCell>{t.scorable ? `${t.correct}/${t.scorable}` : '-'}</TableCell>
                    <TableCell>{formatDate(t.finishedAt || t.updatedAt)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" startIcon={<VisibilityIcon />} onClick={() => setOpen(t)}>Answers</Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Paper>

      {data.takers.length > 0 && (
        <Paper sx={{ p: 3 }}>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
            <QueryStatsIcon color="secondary" />
            <Typography variant="h6" fontWeight={700}>Question by question</Typography>
          </Stack>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Question</TableCell>
                  <TableCell>Skill</TableCell>
                  <TableCell>Answer</TableCell>
                  <TableCell sx={{ minWidth: 160 }}>Got it right</TableCell>
                  <TableCell>Picked</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.questions.map((q) => {
                  const pct = q.answered ? Math.round((100 * q.right) / q.answered) : 0;
                  return (
                    <TableRow key={q.id}>
                      <TableCell>
                        <Typography variant="body2" fontWeight={600}>{q.stage} {q.number}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', maxWidth: 320 }} noWrap>{q.snippet}</Typography>
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="body2">{q.skill || q.domain || 'Uncategorized'}</Typography>
                          <DifficultyChip d={q.difficulty} />
                        </Stack>
                      </TableCell>
                      <TableCell>{q.correct ? q.correct.join(' or ') : '?'}</TableCell>
                      <TableCell>
                        {q.answered ? (
                          <Stack spacing={0.5}>
                            <Typography variant="body2">{q.correct === null ? `${q.answered} answered` : `${q.right}/${q.answered} (${pct}%)`}</Typography>
                            {q.correct !== null && <LinearProgress variant="determinate" value={pct} color={pct >= 70 ? 'success' : pct >= 40 ? 'warning' : 'error'} />}
                          </Stack>
                        ) : (
                          <Typography variant="body2" color="text.secondary">No answers yet</Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                          {Object.entries(q.choices).sort().map(([letter, n]) => (
                            <Chip key={letter} size="small" variant={q.correct?.includes(letter) ? 'filled' : 'outlined'} color={q.correct?.includes(letter) ? 'success' : 'default'} label={`${letter}: ${n}`} />
                          ))}
                        </Stack>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}
      <TakerDialog testId={id} taker={open} onClose={() => setOpen(null)} />
    </Stack>
  );
}
