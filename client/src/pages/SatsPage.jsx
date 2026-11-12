import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Stack, Typography, Button, Paper, Box, Chip, IconButton, Tooltip, LinearProgress, Tabs, Tab, Alert, Dialog, DialogTitle, DialogActions, DialogContent, Skeleton, Snackbar } from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AssessmentIcon from '@mui/icons-material/Assessment';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { api, formatDate } from '../api.js';
import NewTestDialog from '../components/NewTestDialog.jsx';
import ShareCode from '../components/ShareCode.jsx';
import GroupsIcon from '@mui/icons-material/Groups';
import ChecklistIcon from '@mui/icons-material/Checklist';
import PinIcon from '@mui/icons-material/Pin';
import FactCheckIcon from '@mui/icons-material/FactCheck';

function TestRow({ t, onOpen, onDelete, onTakers, onCheck }) {
  const unfinished = t.status !== 'finished';
  return (
    <Paper sx={{ p: 2 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
        <Box sx={{ color: t.kind === 'pdf' ? 'error.main' : 'secondary.main', display: 'flex' }}>{{ pdf: <PictureAsPdfIcon />, manual: <ChecklistIcon />, shared: <PinIcon /> }[t.kind] || <AutoAwesomeIcon />}</Box>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography fontWeight={700} noWrap>{t.title}</Typography>
            <ShareCode code={t.shareCode} />
            {t.config.custom && <Chip size="small" label="Custom" />}
            {t.config.sharedFrom && <Chip size="small" label={`From code ${t.config.sharedFrom}`} />}
            {t.config.fraction < 1 && <Chip size="small" label={`${Math.round(t.config.fraction * 100)}% length`} />}
            {t.config.showWrong && <Chip size="small" icon={<VisibilityIcon />} label="Instant answers" variant="outlined" />}
          </Stack>
          <Typography variant="body2" color="text.secondary">
            {t.modules.join(', ')} - {t.questions} questions - {unfinished ? `last opened ${formatDate(t.updatedAt)}` : `finished ${formatDate(t.finishedAt)}`}
          </Typography>
          {unfinished && <LinearProgress variant="determinate" value={(100 * t.answered) / Math.max(1, t.questions)} sx={{ mt: 1, maxWidth: 360 }} />}
        </Box>
        {t.scores && (
          <Stack direction="row" spacing={1}>
            <Chip color="primary" label={`${t.scores.total}${t.scores.projected ? ' projected' : ''}`} />
            {t.scores.rw !== null && <Chip variant="outlined" label={`R&W ${t.scores.rw}`} />}
            {t.scores.math !== null && <Chip variant="outlined" label={`Math ${t.scores.math}`} />}
          </Stack>
        )}
        <Stack direction="row" spacing={1}>
          {t.takers > 0 && (
            <Button variant="outlined" color="secondary" startIcon={<GroupsIcon />} onClick={onTakers}>
              Takers ({t.takers})
            </Button>
          )}
          {unfinished && t.answered > 0 && (
            <Button variant="outlined" startIcon={<FactCheckIcon />} onClick={onCheck}>
              See answers so far
            </Button>
          )}
          <Button variant={unfinished ? 'contained' : 'outlined'} startIcon={unfinished ? <PlayArrowIcon /> : <AssessmentIcon />} onClick={onOpen}>
            {unfinished ? (t.answered ? 'Continue' : 'Start') : 'Results'}
          </Button>
          <Tooltip title="Delete">
            <IconButton onClick={onDelete}>
              <DeleteOutlineIcon />
            </IconButton>
          </Tooltip>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function SatsPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [tests, setTests] = useState(null);
  const [tab, setTab] = useState(0);
  const [confirm, setConfirm] = useState(null);
  const [checkTest, setCheckTest] = useState(null);
  const [toast, setToast] = useState('');
  const open = params.get('new') === '1';
  const load = () => api.get('/api/tests').then(setTests);
  useEffect(() => {
    load();
  }, []);
  const unfinished = (tests || []).filter((t) => t.status !== 'finished');
  const finished = (tests || []).filter((t) => t.status === 'finished');
  const list = tab === 0 ? unfinished : finished;
  const remove = async () => {
    await api.del(`/api/tests/${confirm.id}`);
    setConfirm(null);
    load();
  };
  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h4" fontWeight={700}>SATs</Typography>
        <Button variant="contained" size="large" startIcon={<AddIcon />} onClick={() => setParams({ new: '1' })}>New</Button>
      </Stack>
      <Tabs value={tab} onChange={(e, v) => setTab(v)}>
        <Tab label={`Unfinished (${unfinished.length})`} />
        <Tab label={`Past SATs (${finished.length})`} />
      </Tabs>
      {!tests ? (
        <Skeleton variant="rounded" height={200} />
      ) : list.length === 0 ? (
        <Alert severity="info">{tab === 0 ? 'No unfinished SATs. Press New to start one.' : 'No finished SATs yet.'}</Alert>
      ) : (
        <Stack spacing={1.5}>
          {list.map((t) => (
            <TestRow key={t.id} t={t} onOpen={() => navigate(t.status === 'finished' ? `/results/${t.id}` : `/test/${t.id}`)} onDelete={() => setConfirm(t)} onTakers={() => navigate(`/takers/${t.id}`)} onCheck={() => setCheckTest(t)} />
          ))}
        </Stack>
      )}
      <NewTestDialog
        open={open}
        onClose={() => setParams({})}
        onCreated={(res) => {
          if (res.found) setToast(`Found ${res.found} questions, ${res.added} added to the database`);
          navigate(`/test/${res.id}`);
        }}
      />
      <Dialog open={!!checkTest} onClose={() => setCheckTest(null)}>
        <DialogTitle>See your answers so far?</DialogTitle>
        <DialogContent>
          <Typography>You will see which of your answers are right or wrong, with explanations. Questions you have answered get locked so they can't be changed. Questions you haven't answered yet stay hidden, and you can keep going afterwards.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCheckTest(null)}>Cancel</Button>
          <Button variant="contained" startIcon={<FactCheckIcon />} onClick={() => navigate(`/results/${checkTest.id}?sofar=1`)}>
            See answers
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>Delete this SAT?</DialogTitle>
        <DialogContent>
          <Typography>{confirm?.title} and its answers will be removed from your account.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button color="error" variant="contained" startIcon={<DeleteOutlineIcon />} onClick={remove}>Delete</Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={!!toast} autoHideDuration={4000} onClose={() => setToast('')} message={toast} />
    </Stack>
  );
}
