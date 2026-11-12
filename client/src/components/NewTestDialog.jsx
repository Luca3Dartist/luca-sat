import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, ToggleButtonGroup, ToggleButton, Stack, Typography, FormGroup, FormControlLabel, Checkbox, Slider, Switch, TextField, Alert, Box, LinearProgress, Paper, Chip } from '@mui/material';
import UploadFileIcon from '@mui/icons-material/UploadFile';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import TimerIcon from '@mui/icons-material/Timer';
import ChecklistIcon from '@mui/icons-material/Checklist';
import PinIcon from '@mui/icons-material/Pin';
import TuneIcon from '@mui/icons-material/Tune';
import { api } from '../api.js';
import CategoryPicker from './CategoryPicker.jsx';
import QuestionPicker from './QuestionPicker.jsx';

const MODULES = [
  { key: 'rw1', label: 'Reading and Writing - Module 1', section: 'rw' },
  { key: 'rw2', label: 'Reading and Writing - Module 2', section: 'rw' },
  { key: 'math1', label: 'Math - Module 1', section: 'math' },
  { key: 'math2', label: 'Math - Module 2', section: 'math' },
];

function CodeInput({ code, setCode }) {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    setInfo(null);
    setError('');
    if (code.length !== 4) return;
    api.get(`/api/tests/code/${code}`).then(setInfo).catch((e) => setError(e.message));
  }, [code]);
  return (
    <Stack spacing={2}>
      <Typography variant="body2" color="text.secondary">Type the 4 character code of a test someone shared with you. You will get the exact same questions.</Typography>
      <TextField
        label="Test code"
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
        inputProps={{ style: { fontSize: 28, letterSpacing: 12, fontWeight: 700, textAlign: 'center' } }}
        autoFocus
      />
      {error && <Alert severity="error">{error}</Alert>}
      {info && <Alert severity="info">{info.by} made this test and will be able to see your score and answers.</Alert>}
      {info && (
        <Paper variant="outlined" sx={{ p: 2 }}>
          <Typography fontWeight={700}>{info.title}</Typography>
          <Typography variant="body2" color="text.secondary">Made by {info.by}, {info.questions} questions</Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
            {info.modules.map((m) => <Chip key={m} size="small" label={m} />)}
          </Stack>
        </Paper>
      )}
    </Stack>
  );
}

export default function NewTestDialog({ open, onClose, onCreated }) {
  const [source, setSource] = useState('generate');
  const [modules, setModules] = useState(['rw1', 'rw2', 'math1', 'math2']);
  const [fraction, setFraction] = useState(1);
  const [showWrong, setShowWrong] = useState(false);
  const [skipCorrect, setSkipCorrect] = useState(true);
  const [bankOnly, setBankOnly] = useState(false);
  const [custom, setCustom] = useState(false);
  const [filters, setFilters] = useState(null);
  const [picked, setPicked] = useState(new Map());
  const [code, setCode] = useState('');
  const [addToDb, setAddToDb] = useState(true);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState('');
  const [meta, setMeta] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setError('');
      api.get('/api/meta').then(setMeta).catch(() => {});
    }
  }, [open]);

  useEffect(() => setError(''), [source]);

  const preview = useMemo(() => {
    if (!meta) return null;
    let questions = 0;
    let minutes = 0;
    for (const m of MODULES) {
      if (!modules.includes(m.key)) continue;
      const full = meta.full[m.section];
      const n = Math.max(1, Math.round(full.count * fraction));
      questions += n;
      minutes += (full.time * n) / full.count / 60;
    }
    const hasBreak = modules.some((k) => k.startsWith('rw')) && modules.some((k) => k.startsWith('math'));
    const brk = hasBreak ? Math.round((meta.full.break * fraction) / 60) : 0;
    return { questions, minutes: Math.round(minutes), brk };
  }, [meta, modules, fraction]);

  const sections = useMemo(() => [...new Set(modules.map((k) => (k.startsWith('rw') ? 'rw' : 'math')))], [modules]);
  const toggle = (key) => setModules((m) => (m.includes(key) ? m.filter((x) => x !== key) : [...m, key]));

  const create = async () => {
    setBusy(true);
    setError('');
    try {
      let res;
      if (source === 'generate') {
        res = await api.post('/api/tests/generate', { modules, fraction, showWrong, skipCorrect, bankOnly, filters: custom ? filters : undefined, title: title || undefined });
      } else if (source === 'pick') {
        res = await api.post('/api/tests/manual', { questionIds: [...picked.keys()], showWrong, title: title || undefined });
      } else if (source === 'code') {
        res = await api.post('/api/tests/from-code', { code, title: title || undefined });
      } else {
        const fd = new FormData();
        fd.append('pdf', file);
        fd.append('modules', modules.join(','));
        fd.append('fraction', String(fraction));
        fd.append('showWrong', String(showWrong));
        fd.append('addToDatabase', String(addToDb));
        if (title) fd.append('title', title);
        res = await api.form('/api/tests/import', fd);
      }
      onCreated(res);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const marks = [
    { value: 0, label: '1 each' },
    { value: 0.25, label: '1/4' },
    { value: 0.5, label: '1/2' },
    { value: 0.75, label: '3/4' },
    { value: 1, label: 'Full' },
  ];

  const customReady = !custom || (filters?.skills?.length > 0 && filters?.difficulties?.length > 0);
  const canCreate =
    !busy &&
    (source === 'pick' ? picked.size > 0 : source === 'code' ? code.length === 4 : modules.length > 0 && (source !== 'pdf' || !!file) && (source !== 'generate' || customReady));

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth={source === 'pick' ? 'lg' : 'sm'}>
      <DialogTitle fontWeight={700}>New SAT</DialogTitle>
      <DialogContent>
        <Stack spacing={3} sx={{ pt: 1 }}>
          <ToggleButtonGroup exclusive fullWidth value={source} onChange={(e, v) => v && setSource(v)} color="primary" size="small">
            <ToggleButton value="generate">
              <AutoAwesomeIcon sx={{ mr: 1 }} /> Generate
            </ToggleButton>
            <ToggleButton value="pick">
              <ChecklistIcon sx={{ mr: 1 }} /> Pick questions
            </ToggleButton>
            <ToggleButton value="pdf">
              <PictureAsPdfIcon sx={{ mr: 1 }} /> Import PDF
            </ToggleButton>
            <ToggleButton value="code">
              <PinIcon sx={{ mr: 1 }} /> Use a code
            </ToggleButton>
          </ToggleButtonGroup>

          {source === 'code' && <CodeInput code={code} setCode={setCode} />}

          {source === 'pick' && (
            <>
              <Typography variant="body2" color="text.secondary">
                Choose questions from the database or from tests you already made. Reading and Writing questions become one module and Math questions another, with time based on how many you pick.
              </Typography>
              <QuestionPicker selected={picked} setSelected={setPicked} />
            </>
          )}

          {source === 'generate' && meta && (
            <Typography variant="body2" color="text.secondary">
              Questions are picked at random from {bankOnly ? 'the College Board question bank' : 'the whole database'} ({bankOnly ? meta.bankOnly.rw : meta.bank.rw} Reading and Writing, {bankOnly ? meta.bankOnly.math : meta.bank.math} Math available). Questions you have not seen yet are preferred.
            </Typography>
          )}

          {source === 'pdf' && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack spacing={1.5}>
                <Button component="label" variant="outlined" startIcon={<UploadFileIcon />}>
                  {file ? file.name : 'Choose an SAT practice test PDF'}
                  <input hidden type="file" accept="application/pdf" onChange={(e) => setFile(e.target.files?.[0] || null)} />
                </Button>
                <FormControlLabel control={<Checkbox checked={addToDb} onChange={(e) => setAddToDb(e.target.checked)} />} label="Add new questions to the database so they can be used in generated tests" />
              </Stack>
            </Paper>
          )}

          <TextField label="Name (optional)" value={title} onChange={(e) => setTitle(e.target.value)} fullWidth size="small" />

          {(source === 'generate' || source === 'pdf') && (
            <>
              <Box>
                <Typography fontWeight={600} gutterBottom>Modules</Typography>
                <FormGroup>
                  {MODULES.map((m) => (
                    <FormControlLabel key={m.key} control={<Checkbox checked={modules.includes(m.key)} onChange={() => toggle(m.key)} />} label={m.label} />
                  ))}
                </FormGroup>
              </Box>

              <Box sx={{ px: 1 }}>
                <Typography fontWeight={600} gutterBottom>Test length</Typography>
                <Slider value={fraction} min={0} max={1} step={0.05} marks={marks} onChange={(e, v) => setFraction(v)} valueLabelDisplay="auto" valueLabelFormat={(v) => (v === 0 ? '1 question each' : `${Math.round(v * 100)}%`)} />
                {preview && source === 'generate' && (
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary' }}>
                    <TimerIcon fontSize="small" />
                    <Typography variant="body2">
                      {preview.questions} questions, about {preview.minutes} minutes{preview.brk ? ` plus a ${preview.brk} minute break` : ''}
                    </Typography>
                  </Stack>
                )}
                {source === 'pdf' && <Typography variant="body2" color="text.secondary">Questions, time and breaks from the PDF are scaled by the same amount.</Typography>}
              </Box>
            </>
          )}

          {source !== 'code' && (
            <Stack>
              <FormControlLabel control={<Switch checked={showWrong} onChange={(e) => setShowWrong(e.target.checked)} />} label="Show right and wrong answers instantly" />
              {source === 'generate' && (
                <>
                  <FormControlLabel control={<Switch checked={skipCorrect} onChange={(e) => setSkipCorrect(e.target.checked)} />} label="Skip questions I already got right" />
                  <FormControlLabel control={<Switch checked={bankOnly} onChange={(e) => setBankOnly(e.target.checked)} />} label="Question bank only" />
                  <FormControlLabel
                    control={<Switch checked={custom} onChange={(e) => setCustom(e.target.checked)} />}
                    label={
                      <Stack direction="row" spacing={0.5} alignItems="center">
                        <TuneIcon fontSize="small" />
                        <span>Custom: choose categories and difficulty</span>
                      </Stack>
                    }
                  />
                </>
              )}
            </Stack>
          )}

          {source === 'generate' && custom && sections.length > 0 && <CategoryPicker bankOnly={bankOnly} sections={sections} onChange={setFilters} />}

          {error && <Alert severity="error">{error}</Alert>}
          {busy && source === 'pdf' && (
            <Box>
              <Typography variant="body2" color="text.secondary" gutterBottom>Reading the PDF and building the test...</Typography>
              <LinearProgress />
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant="contained" startIcon={<PlayArrowIcon />} onClick={create} disabled={!canCreate}>
          {source === 'pick' && picked.size ? `Create with ${picked.size} questions` : 'Create and start'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
