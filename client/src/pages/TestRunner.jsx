import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Box, AppBar, Toolbar, Typography, Button, IconButton, Tooltip, Stack, Paper, Chip, Drawer, Popover, Grid, CircularProgress, Alert, Dialog, DialogTitle, DialogContent, DialogActions, Container, Divider, alpha } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import BookmarkIcon from '@mui/icons-material/Bookmark';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import FunctionsIcon from '@mui/icons-material/Functions';
import TimerIcon from '@mui/icons-material/Timer';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import VisibilityIcon from '@mui/icons-material/Visibility';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExitToAppIcon from '@mui/icons-material/ExitToApp';
import SendIcon from '@mui/icons-material/Send';
import FreeBreakfastIcon from '@mui/icons-material/FreeBreakfast';
import FlagIcon from '@mui/icons-material/Flag';
import StrikethroughSIcon from '@mui/icons-material/StrikethroughS';
import FactCheckIcon from '@mui/icons-material/FactCheck';
import { api, formatTime } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useColorMode } from '../colorMode.js';
import QuestionView, { Explanation } from '../components/QuestionView.jsx';
import AiChat from '../components/AiChat.jsx';

function useCountdown(initial, running, stageKey, onEnd) {
  const [remaining, setRemaining] = useState(initial);
  const remRef = useRef(initial);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    remRef.current = initial;
    setRemaining(initial);
  }, [initial, stageKey]);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const base = remRef.current;
    let ended = false;
    const id = setInterval(() => {
      const left = Math.max(0, base - (Date.now() - started) / 1000);
      remRef.current = left;
      setRemaining(left);
      if (left <= 0 && !ended) {
        ended = true;
        clearInterval(id);
        endRef.current?.();
      }
    }, 250);
    return () => clearInterval(id);
  }, [running, initial, stageKey]);
  return [remaining, setRemaining];
}

const DESMOS_MIN = 320;
const DESMOS_KEY = 'desmosWidth';

function loadDesmosWidth() {
  try {
    const w = Number(localStorage.getItem(DESMOS_KEY));
    if (w >= DESMOS_MIN) return w;
  } catch {}
  return 520;
}

function DesmosDrawer({ open, onClose, width, onResize }) {
  const [dragging, setDragging] = useState(false);

  const startDrag = (e) => {
    e.preventDefault();
    setDragging(true);
    const move = (ev) => {
      const max = Math.max(DESMOS_MIN, window.innerWidth - 360);
      onResize(Math.round(Math.min(max, Math.max(DESMOS_MIN, window.innerWidth - ev.clientX))));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <Drawer anchor="right" variant="persistent" open={open} PaperProps={{ sx: { width: { xs: '100%', md: width }, top: 64, height: 'calc(100% - 64px - 72px)', overflow: 'visible' } }}>
      <Tooltip title="Drag to resize" placement="left">
        <Box
          onPointerDown={startDrag}
          sx={{
            display: { xs: 'none', md: 'flex' },
            position: 'absolute',
            left: -6,
            top: 0,
            bottom: 0,
            width: 12,
            cursor: 'col-resize',
            zIndex: 2,
            alignItems: 'center',
            justifyContent: 'center',
            '&:hover > div, & > div.active': { bgcolor: 'primary.main' },
          }}
        >
          <Box className={dragging ? 'active' : ''} sx={{ width: 4, height: 48, borderRadius: 2, bgcolor: 'divider', transition: 'background-color .15s' }} />
        </Box>
      </Tooltip>
      {/* While dragging, cover the iframe so it doesn't swallow the pointer. */}
      {dragging && <Box sx={{ position: 'fixed', inset: 0, zIndex: 3, cursor: 'col-resize' }} />}
      <Stack direction="row" alignItems="center" sx={{ px: 2, py: 1, borderBottom: 1, borderColor: 'divider' }}>
        <FunctionsIcon sx={{ mr: 1 }} />
        <Typography fontWeight={700} sx={{ flexGrow: 1 }}>Desmos Graphing Calculator</Typography>
        <IconButton onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </Stack>
      <Box component="iframe" title="Desmos" src="https://www.desmos.com/calculator" sx={{ border: 0, width: '100%', flexGrow: 1 }} />
    </Drawer>
  );
}

function BreakScreen({ stage, remaining, onResume }) {
  return (
    <Container maxWidth="sm" sx={{ py: 8 }}>
      <Paper sx={{ p: 5, textAlign: 'center' }}>
        <FreeBreakfastIcon color="primary" sx={{ fontSize: 56 }} />
        <Typography variant="h4" fontWeight={700} sx={{ mt: 1 }}>Take a break</Typography>
        <Typography variant="h2" fontWeight={700} sx={{ my: 3, fontVariantNumeric: 'tabular-nums' }}>{formatTime(remaining)}</Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>You can stand up, stretch and drink some water. The next section starts when the timer ends, or you can resume early.</Typography>
        <Button variant="contained" size="large" startIcon={<ArrowForwardIcon />} onClick={onResume}>Resume testing</Button>
      </Paper>
    </Container>
  );
}

function ReviewScreen({ stage, answers, flagged, onJump, onSubmit, last, timed }) {
  return (
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Paper sx={{ p: 4 }}>
        <Typography variant="h5" fontWeight={700} textAlign="center">Check your work</Typography>
        <Typography color="text.secondary" textAlign="center" sx={{ mb: 3 }}>
          {timed ? 'On test day you will not be able to move on to the next module until time expires. For this practice, you can submit when you are ready.' : 'This practice is not timed. Submit when you are ready.'}
        </Typography>
        <Divider sx={{ mb: 2 }} />
        <Typography fontWeight={700} sx={{ mb: 2 }}>{stage.title}</Typography>
        <Grid container spacing={1}>
          {stage.questions.map((q, i) => {
            const answered = answers[q.id] !== undefined && answers[q.id] !== null && answers[q.id] !== '';
            return (
              <Grid item key={q.id}>
                <Button variant={answered ? 'contained' : 'outlined'} onClick={() => onJump(i)} sx={{ minWidth: 44, position: 'relative' }}>
                  {i + 1}
                  {flagged.includes(q.id) && <FlagIcon sx={{ position: 'absolute', top: -8, right: -8, fontSize: 18, color: 'error.main' }} />}
                </Button>
              </Grid>
            );
          })}
        </Grid>
        <Stack direction="row" justifyContent="flex-end" sx={{ mt: 4 }}>
          <Button variant="contained" size="large" endIcon={<SendIcon />} onClick={onSubmit}>{last ? 'Submit test' : 'Submit module'}</Button>
        </Stack>
      </Paper>
    </Container>
  );
}

export default function TestRunner() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { glass } = useColorMode();
  const decorated = glass || !!user.background;
  const [test, setTest] = useState(null);
  const [error, setError] = useState('');
  const [index, setIndex] = useState(0);
  const [reviewing, setReviewing] = useState(false);
  const [desmos, setDesmos] = useState(false);
  const [desmosWidth, setDesmosWidth] = useState(loadDesmosWidth);
  const [hideTimer, setHideTimer] = useState(false);
  const [navAnchor, setNavAnchor] = useState(null);
  const [feedback, setFeedback] = useState({});
  const [confirmExit, setConfirmExit] = useState(false);
  const [confirmCheck, setConfirmCheck] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [crossMode, setCrossMode] = useState(false);

  const load = useCallback(async () => {
    try {
      const t = await api.get(`/api/tests/${id}`);
      if (t.status === 'finished') return navigate(`/results/${id}`, { replace: true });
      setTest(t);
      setIndex(t.state.current?.[t.state.stage] || 0);
      setReviewing(false);
    } catch (e) {
      setError(e.message);
    }
  }, [id, navigate]);

  useEffect(() => {
    load();
  }, [load]);

  const stage = test?.stages[test.state.stage];
  const initial = test ? test.state.remaining[test.state.stage] ?? stage.time : 0;
  // Last if every other module has been submitted (submitted modules have 0 time left).
  const isLastStage = test ? !test.stages.some((s, i) => s.kind === 'module' && i !== test.state.stage && !(test.state.remaining[i] !== undefined && test.state.remaining[i] <= 0)) : false;
  // Tests made before the Timed switch existed have no setting and stay timed.
  const timed = test ? test.config.timed !== false : true;

  const advance = useCallback(async () => {
    if (!test || advancing) return;
    setAdvancing(true);
    try {
      const r = await api.post(`/api/tests/${id}/next`, { from: test.state.stage });
      setDesmos(false);
      if (r.finished) navigate(`/results/${id}`, { replace: true });
      else await load();
    } finally {
      setAdvancing(false);
    }
  }, [test, id, load, navigate, advancing]);

  const resizeDesmos = useCallback((w) => {
    setDesmosWidth(w);
    try {
      localStorage.setItem(DESMOS_KEY, String(w));
    } catch {}
  }, []);

  const [remaining] = useCountdown(initial, !!test && timed, test ? `${test.id}-${test.state.stage}` : '', advance);
  const remainingRef = useRef(remaining);
  remainingRef.current = remaining;

  const gotoModule = useCallback(async (to) => {
    if (!test || advancing || to === test.state.stage) return;
    setAdvancing(true);
    try {
      await api.post(`/api/tests/${id}/goto`, { to, remaining: remainingRef.current });
      setDesmos(false);
      setNavAnchor(null);
      await load();
    } catch {
      // The button is disabled for modules that can't be opened; a failed jump just stays put.
    } finally {
      setAdvancing(false);
    }
  }, [test, id, load, advancing]);

  useEffect(() => {
    if (!test) return;
    const stageNo = test.state.stage;
    const save = () => api.put(`/api/tests/${id}/state`, { stage: stageNo, remaining: remainingRef.current }).catch(() => {});
    const t = setInterval(save, 10000);
    window.addEventListener('beforeunload', save);
    return () => {
      clearInterval(t);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [test, id]);

  useEffect(() => {
    if (!test || stage?.kind !== 'module') return;
    api.put(`/api/tests/${id}/state`, { stage: test.state.stage, current: { [test.state.stage]: index }, remaining: remainingRef.current }).catch(() => {});
  }, [index]);

  if (error) return <Alert severity="error" sx={{ m: 4 }}>{error}</Alert>;
  if (!test) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const checkDialog = (
    <Dialog open={confirmCheck} onClose={() => setConfirmCheck(false)}>
      <DialogTitle>Check your answers so far?</DialogTitle>
      <DialogContent>
        <Typography>You will see which of your answers are right or wrong, with explanations. Questions you have answered get locked so they can't be changed. Questions you haven't answered yet stay hidden, and you can come back and keep going.</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirmCheck(false)}>Cancel</Button>
        <Button
          variant="contained"
          startIcon={<FactCheckIcon />}
          onClick={async () => {
            await api.put(`/api/tests/${id}/state`, { stage: test.state.stage, remaining: remainingRef.current }).catch(() => {});
            navigate(`/results/${id}?sofar=1`);
          }}
        >
          Check answers
        </Button>
      </DialogActions>
    </Dialog>
  );

  const exitBar = (
    <Tooltip title="Save and exit">
      <IconButton onClick={() => setConfirmExit(true)}>
        <ExitToAppIcon />
      </IconButton>
    </Tooltip>
  );

  const exitDialog = (
    <Dialog open={confirmExit} onClose={() => setConfirmExit(false)}>
      <DialogTitle>Save and exit?</DialogTitle>
      <DialogContent>
        <Typography>Your answers and remaining time are saved. You can continue this SAT later from the SATs tab.</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setConfirmExit(false)}>Keep going</Button>
        <Button
          variant="contained"
          startIcon={<ExitToAppIcon />}
          onClick={async () => {
            await api.put(`/api/tests/${id}/state`, { remaining: remainingRef.current }).catch(() => {});
            navigate('/sats');
          }}
        >
          Save and exit
        </Button>
      </DialogActions>
    </Dialog>
  );

  if (stage.kind === 'break') {
    return (
      <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
        <AppBar position="sticky" color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Toolbar>
            <Typography fontWeight={700} sx={{ flexGrow: 1 }}>{test.title}</Typography>
            {exitBar}
          </Toolbar>
        </AppBar>
        <BreakScreen stage={stage} remaining={remaining} onResume={advance} />
        {exitDialog}
      </Box>
    );
  }

  const questions = stage.questions;
  const q = questions[index];
  const answers = test.state.answers;
  const flagged = test.state.flagged;
  const instant = !!test.config.showWrong;
  const locked = !!test.state.checked[q.id];
  const fb = feedback[q.id] || (locked ? { answer: q.correct || null, correct: q.isCorrect ?? null } : null);
  const wasCorrect = feedback[q.id]?.correct ?? q.isCorrect;
  const isWrong = locked && wasCorrect === false;
  const aiOn = user.ai?.enabled;

  const setAnswer = async (value, check) => {
    const nextAnswers = { ...answers, [q.id]: value };
    setTest((t) => ({ ...t, state: { ...t.state, answers: nextAnswers } }));
    const res = await api.post(`/api/tests/${id}/answer`, { questionId: q.id, answer: value, check: !!check, remaining: remainingRef.current });
    if (res.feedback && res.feedback.correct !== null) {
      setFeedback((f) => ({ ...f, [q.id]: res.feedback }));
      setTest((t) => {
        const stages = t.stages.map((s, si) => (si !== t.state.stage ? s : { ...s, questions: s.questions.map((x) => (x.id === q.id ? { ...x, correct: res.feedback.answer, rationale_html: res.feedback.rationale_html, explanationAi: res.feedback.explanationAi } : x)) }));
        return { ...t, stages: stages.map((s) => ({ ...s, questions: s.questions?.map((x) => (x.id === q.id ? { ...x, isCorrect: res.feedback.correct } : x)) })), state: { ...t.state, checked: { ...t.state.checked, [q.id]: true } } };
      });
    }
  };

  const toggleFlag = () => {
    const next = flagged.includes(q.id) ? flagged.filter((x) => x !== q.id) : [...flagged, q.id];
    setTest((t) => ({ ...t, state: { ...t.state, flagged: next } }));
    api.put(`/api/tests/${id}/state`, { flagged: next }).catch(() => {});
  };

  const crossed = test.state.crossed?.[q.id] || [];
  const toggleCross = (letter) => {
    const list = crossed.includes(letter) ? crossed.filter((x) => x !== letter) : [...crossed, letter];
    const all = { ...(test.state.crossed || {}), [q.id]: list };
    setTest((t) => ({ ...t, state: { ...t.state, crossed: all } }));
    api.put(`/api/tests/${id}/state`, { crossed: { [q.id]: list } }).catch(() => {});
  };

  const lowTime = remaining < 300;

  const moduleStages = test.stages.map((s, i) => ({ ...s, index: i })).filter((s) => s.kind === 'module');
  const modules = moduleStages.map((s) => {
    const name = s.section === 'rw' ? 'English' : 'Math';
    const single = moduleStages.filter((x) => x.section === s.section).length === 1;
    return { index: s.index, label: single ? name : `${name} ${s.module || moduleStages.filter((x) => x.section === s.section && x.index <= s.index).length}` };
  });

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: decorated ? 'transparent' : 'background.paper', pb: 12 }}>
      <AppBar position="sticky" color="inherit" sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Toolbar sx={{ gap: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography fontWeight={700} noWrap>{stage.title}</Typography>
            <Typography variant="caption" color="text.secondary" noWrap>{test.title}</Typography>
          </Box>
          <Stack alignItems="center" sx={{ flex: 1 }}>
            {timed && !hideTimer && (
              <Chip icon={<TimerIcon />} label={formatTime(remaining)} color={lowTime ? 'error' : 'default'} sx={{ fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums', px: 1 }} />
            )}
            {timed ? (
              <Button size="small" startIcon={hideTimer ? <VisibilityIcon /> : <VisibilityOffIcon />} onClick={() => setHideTimer((h) => !h)}>
                {hideTimer ? 'Show' : 'Hide'}
              </Button>
            ) : (
              <Typography variant="caption" color="text.secondary">Untimed</Typography>
            )}
          </Stack>
          <Stack direction="row" spacing={1} sx={{ flex: 1, justifyContent: 'flex-end' }}>
            {stage.section === 'math' && (
              <Button variant={desmos ? 'contained' : 'outlined'} startIcon={<FunctionsIcon />} onClick={() => setDesmos((d) => !d)}>
                Calculator
              </Button>
            )}
            <Tooltip title="Check answers so far">
              <IconButton onClick={() => setConfirmCheck(true)}>
                <FactCheckIcon />
              </IconButton>
            </Tooltip>
            {exitBar}
          </Stack>
        </Toolbar>
      </AppBar>

      {reviewing ? (
        <ReviewScreen
          stage={stage}
          answers={answers}
          flagged={flagged}
          last={isLastStage}
          timed={timed}
          onJump={(i) => {
            setIndex(i);
            setReviewing(false);
          }}
          onSubmit={advance}
        />
      ) : (
        <Box sx={{ mr: { md: desmos ? `${desmosWidth}px` : 0 }, transition: 'margin .2s' }}>
          <Container maxWidth="lg" sx={{ py: 3 }}>
            <Box component={decorated ? Paper : 'div'} sx={decorated ? { p: { xs: 2, md: 3 }, bgcolor: (t) => (glass ? t.frost.backgroundColor : alpha(t.palette.background.paper, 0.85)), backdropFilter: (t) => (glass ? t.frost.backdropFilter : 'none') } : {}}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ mb: 2, bgcolor: 'action.hover', px: 2, py: 1, borderRadius: 2 }}>
              <Chip label={index + 1} color="primary" sx={{ fontWeight: 700 }} />
              <Button size="small" startIcon={flagged.includes(q.id) ? <BookmarkIcon color="error" /> : <BookmarkBorderIcon />} onClick={toggleFlag} color="inherit">
                Mark for review
              </Button>
              <Box sx={{ flexGrow: 1 }} />
              {q.type === 'mcq' && (
                <Tooltip title="Cross out answer choices you think are wrong">
                  <Button size="small" variant={crossMode ? 'contained' : 'outlined'} startIcon={<StrikethroughSIcon />} onClick={() => setCrossMode((c) => !c)}>
                    Cross out
                  </Button>
                </Tooltip>
              )}
            </Stack>
            <QuestionView question={q} answer={answers[q.id]} onAnswer={setAnswer} locked={locked} feedback={fb} instant={instant} crossMode={crossMode} crossed={crossed} onCross={toggleCross} />
            {locked && <Explanation html={q.rationale_html} ai={q.explanationAi} sx={{ mt: 2, maxWidth: 760, mx: 'auto' }} />}
            {isWrong && aiOn && (
              <Box sx={{ mt: 2, maxWidth: 760, mx: 'auto' }}>
                <AiChat testId={test.id} questionId={q.id} />
              </Box>
            )}
            </Box>
          </Container>
        </Box>
      )}

      <Paper square data-no-glass sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, borderTop: 1, borderColor: 'divider', zIndex: 1300, ...(decorated ? { bgcolor: (t) => alpha(t.palette.background.paper, 0.7), backdropFilter: 'blur(22px)' } : {}) }}>
        <Stack direction="row" alignItems="center" sx={{ px: 3, py: 1.5 }}>
          <Typography sx={{ flex: 1 }} color="text.secondary">{user.username}</Typography>
          <Button variant="contained" color="inherit" endIcon={<ExpandLessIcon />} onClick={(e) => setNavAnchor(e.currentTarget)} sx={{ bgcolor: 'grey.900', color: '#fff', '&:hover': { bgcolor: 'grey.800' } }}>
            {reviewing ? 'Review' : `Question ${index + 1} of ${questions.length}`}
          </Button>
          <Stack direction="row" spacing={1} sx={{ flex: 1, justifyContent: 'flex-end' }}>
            <Button variant="outlined" startIcon={<ArrowBackIcon />} disabled={!reviewing && index === 0} onClick={() => (reviewing ? setReviewing(false) : setIndex((i) => i - 1))}>
              Back
            </Button>
            {!reviewing && (
              <Button variant="contained" endIcon={<ArrowForwardIcon />} onClick={() => (index === questions.length - 1 ? setReviewing(true) : setIndex((i) => i + 1))}>
                Next
              </Button>
            )}
          </Stack>
        </Stack>
      </Paper>

      <Popover open={!!navAnchor} anchorEl={navAnchor} onClose={() => setNavAnchor(null)} anchorOrigin={{ vertical: 'top', horizontal: 'center' }} transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
        <Box sx={{ p: 2, maxWidth: 420 }}>
          <Typography fontWeight={700} sx={{ mb: 1 }}>{stage.title}</Typography>
          <Grid container spacing={1}>
            {questions.map((qq, i) => {
              const answered = answers[qq.id] !== undefined && answers[qq.id] !== null && answers[qq.id] !== '';
              return (
                <Grid item key={qq.id}>
                  <Button
                    size="small"
                    variant={answered ? 'contained' : 'outlined'}
                    color={i === index && !reviewing ? 'secondary' : 'primary'}
                    sx={{ minWidth: 38, position: 'relative' }}
                    onClick={() => {
                      setIndex(i);
                      setReviewing(false);
                      setNavAnchor(null);
                    }}
                  >
                    {i + 1}
                    {flagged.includes(qq.id) && <FlagIcon sx={{ position: 'absolute', top: -7, right: -7, fontSize: 16, color: 'error.main' }} />}
                  </Button>
                </Grid>
              );
            })}
          </Grid>
          {modules.length > 1 && (
            <>
              <Divider sx={{ my: 2 }} />
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {modules.map((m) => {
                  const current = m.index === test.state.stage;
                  const left = test.state.remaining[m.index];
                  const outOfTime = timed && !current && left !== undefined && left <= 0;
                  return (
                    <Tooltip key={m.index} title={outOfTime ? 'This module is out of time' : ''}>
                      <span style={{ flex: 1 }}>
                        <Button fullWidth size="small" variant={current ? 'contained' : 'outlined'} disabled={outOfTime || advancing} onClick={() => gotoModule(m.index)} sx={{ whiteSpace: 'nowrap' }}>
                          {m.label}
                        </Button>
                      </span>
                    </Tooltip>
                  );
                })}
              </Stack>
            </>
          )}
        </Box>
      </Popover>

      {stage.section === 'math' && <DesmosDrawer open={desmos} onClose={() => setDesmos(false)} width={desmosWidth} onResize={resizeDesmos} />}
      {exitDialog}
      {checkDialog}
    </Box>
  );
}
