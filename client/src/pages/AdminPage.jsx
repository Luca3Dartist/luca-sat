import { useEffect, useRef, useState } from 'react';
import { Stack, Typography, Paper, Tabs, Tab, Table, TableHead, TableRow, TableCell, TableBody, IconButton, Tooltip, Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Alert, Chip, Switch, Box, LinearProgress, Grid, MenuItem, TablePagination, Accordion, AccordionSummary, AccordionDetails, FormControlLabel, Checkbox, Autocomplete } from '@mui/material';
import LockResetIcon from '@mui/icons-material/LockReset';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import SaveIcon from '@mui/icons-material/Save';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import SearchIcon from '@mui/icons-material/Search';
import PeopleIcon from '@mui/icons-material/People';
import MrAiIcon from '@mui/icons-material/SentimentSatisfiedAlt';
import StorageIcon from '@mui/icons-material/Storage';
import StopIcon from '@mui/icons-material/Stop';
import DescriptionIcon from '@mui/icons-material/Description';
import { api, formatDate } from '../api.js';
import { useAuth } from '../auth.jsx';
import QuestionView, { DifficultyChip } from '../components/QuestionView.jsx';

const MODELS = ['nvidia/nemotron-3-ultra-550b-a55b:free', 'openai/gpt-6.1-terra', 'anthropic/claude-opus-5.5', 'anthropic/claude-sonnet-5.5'];

function UsersTab() {
  const { user } = useAuth();
  const [users, setUsers] = useState([]);
  const [reset, setReset] = useState(null);
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState(null);
  const [del, setDel] = useState(null);
  const load = () => api.get('/api/admin/users').then(setUsers);
  useEffect(() => {
    load();
  }, []);
  const doReset = async () => {
    await api.post(`/api/admin/users/${reset.id}/password`, { password: pw });
    setMsg({ type: 'success', text: `Password for ${reset.username} was reset` });
    setReset(null);
    setPw('');
  };
  const patch = async (u, body) => {
    try {
      await api.patch(`/api/admin/users/${u.id}`, body);
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  };
  return (
    <Paper>
      {msg && <Alert severity={msg.type} onClose={() => setMsg(null)} sx={{ m: 2 }}>{msg.text}</Alert>}
      <Table>
        <TableHead>
          <TableRow>
            <TableCell>User</TableCell>
            <TableCell>Joined</TableCell>
            <TableCell>SATs</TableCell>
            <TableCell>Mr AI</TableCell>
            <TableCell>Premium</TableCell>
            <TableCell>Admin</TableCell>
            <TableCell align="right">Actions</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((u) => (
            <TableRow key={u.id}>
              <TableCell><b>{u.username}</b></TableCell>
              <TableCell>{formatDate(u.created_at)}</TableCell>
              <TableCell>{u.tests}</TableCell>
              <TableCell>{u.hate_ai ? <Chip size="small" label="Off" /> : <Chip size="small" color="success" variant="outlined" label="On" />}</TableCell>
              <TableCell><Switch checked={!!u.premium} onChange={() => patch(u, { premium: !u.premium })} color="secondary" /></TableCell>
              <TableCell><Switch checked={!!u.is_admin} onChange={() => patch(u, { isAdmin: !u.is_admin })} disabled={u.id === user.id} /></TableCell>
              <TableCell align="right">
                <Tooltip title="Reset password">
                  <IconButton onClick={() => setReset(u)}><LockResetIcon /></IconButton>
                </Tooltip>
                <Tooltip title="Delete user">
                  <span>
                    <IconButton onClick={() => setDel(u)} disabled={u.id === user.id}><DeleteOutlineIcon /></IconButton>
                  </span>
                </Tooltip>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!reset} onClose={() => setReset(null)}>
        <DialogTitle>Reset password for {reset?.username}</DialogTitle>
        <DialogContent>
          <TextField autoFocus fullWidth label="New password" value={pw} onChange={(e) => setPw(e.target.value)} sx={{ mt: 1 }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setReset(null)}>Cancel</Button>
          <Button variant="contained" startIcon={<LockResetIcon />} onClick={doReset}>Reset</Button>
        </DialogActions>
      </Dialog>
      <Dialog open={!!del} onClose={() => setDel(null)}>
        <DialogTitle>Delete {del?.username}?</DialogTitle>
        <DialogContent>
          <Typography>This removes the account and all of its SATs. It cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDel(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            startIcon={<DeleteOutlineIcon />}
            onClick={async () => {
              await api.del(`/api/admin/users/${del.id}`);
              setDel(null);
              load();
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Paper>
  );
}

function AiTab() {
  const [cfg, setCfg] = useState(null);
  const [key, setKey] = useState('');
  const [models, setModels] = useState({ freeModel: '', premiumModel: '', jevModel: '', llmModel: '' });
  const [msg, setMsg] = useState(null);
  const load = () =>
    api.get('/api/admin/ai').then((c) => {
      setCfg(c);
      setModels({ freeModel: c.freeModel, premiumModel: c.premiumModel, jevModel: c.jevModel, llmModel: c.llmModel });
    });
  useEffect(() => {
    load();
  }, []);
  const save = async (body, text) => {
    try {
      await api.put('/api/admin/ai', body);
      setMsg({ type: 'success', text });
      load();
    } catch (e) {
      setMsg({ type: 'error', text: e.message });
    }
  };
  const modelField = (field, label, helperText) => (
    <Autocomplete freeSolo options={MODELS} value={models[field]} onInputChange={(e, v) => setModels((m) => ({ ...m, [field]: v }))} renderInput={(p) => <TextField {...p} size="small" label={label} helperText={helperText} />} />
  );
  if (!cfg) return <LinearProgress />;
  return (
    <Stack spacing={2}>
      {msg && <Alert severity={msg.type} onClose={() => setMsg(null)}>{msg.text}</Alert>}
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>OpenRouter key</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          One key runs everything: Mr AI, JEV and answer filling. Current key: <b>{cfg.key || 'none'}</b>
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={9}>
            <TextField fullWidth size="small" label="New OpenRouter API key (sk-or-...)" value={key} onChange={(e) => setKey(e.target.value)} />
          </Grid>
          <Grid item xs={12} md={3}>
            <Button fullWidth variant="contained" startIcon={<SaveIcon />} disabled={!key.trim()} onClick={() => save({ key }, 'OpenRouter key saved').then(() => setKey(''))}>Save</Button>
          </Grid>
        </Grid>
      </Paper>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>Models</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Mr AI uses the free model for everyone, and the premium model for users you switch to Premium in the Users tab. Generate answers uses JEV for multiple choice questions and categories, and the answer-filling LLM for typed answers, picture questions and anything JEV is unsure about.
        </Typography>
        <Grid container spacing={2}>
          <Grid item xs={12} md={6}>{modelField('freeModel', 'Free model (default)')}</Grid>
          <Grid item xs={12} md={6}>{modelField('premiumModel', 'Premium model')}</Grid>
          <Grid item xs={12} md={6}>
            <TextField fullWidth size="small" label="JEV model" helperText="Uses the OpenRouter decisions API" value={models.jevModel} onChange={(e) => setModels((m) => ({ ...m, jevModel: e.target.value }))} />
          </Grid>
          <Grid item xs={12} md={6}>{modelField('llmModel', 'Answer-filling LLM', 'Empty uses the premium model')}</Grid>
          <Grid item xs={12}>
            <Button variant="contained" startIcon={<SaveIcon />} onClick={() => save(models, 'Models saved')}>Save models</Button>
          </Grid>
        </Grid>
      </Paper>
    </Stack>
  );
}

function JobCard({ title, description, icon, job, onStart, onStop, buttonLabel, extra }) {
  const pct = job && job.total ? (100 * job.done) / job.total : 0;
  return (
    <Paper sx={{ p: 3, height: '100%' }}>
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          {icon}
          <Typography variant="h6" fontWeight={700}>{title}</Typography>
        </Stack>
        <Typography variant="body2" color="text.secondary">{description}</Typography>
        {job && (
          <Box>
            <Typography variant="body2">
              {job.auto ? 'Automatic run: ' : ''}{job.message} {job.total ? `- ${job.done} of ${job.total}` : ''} {job.running && job.categorized !== undefined ? `- ${job.jev + job.llm} answered, ${job.categorized} categorized` : job.added ? `- ${job.added} added` : ''} {job.failed ? `- ${job.failed} failed` : ''}
            </Typography>
            {job.running && <LinearProgress variant={job.total ? 'determinate' : 'indeterminate'} value={pct} sx={{ mt: 1 }} />}
            {job.error && <Alert severity="error" sx={{ mt: 1 }}>{job.error}</Alert>}
            {job.lastError && !job.running && job.failed > 0 && <Alert severity="warning" sx={{ mt: 1 }}>Last error: {job.lastError}</Alert>}
          </Box>
        )}
        {extra}
        <Stack direction="row" spacing={1}>
          <Button variant="contained" startIcon={icon} onClick={onStart} disabled={job?.running}>{buttonLabel}</Button>
          {job?.running && (
            <Button variant="outlined" color="error" startIcon={<StopIcon />} onClick={onStop} disabled={job.stop}>
              {job.stop ? 'Stopping' : 'Stop'}
            </Button>
          )}
        </Stack>
      </Stack>
    </Paper>
  );
}

function QuestionEditor({ q, onSaved }) {
  const [correct, setCorrect] = useState((q.correct || []).join(', '));
  const [domain, setDomain] = useState(q.domain || '');
  const [skill, setSkill] = useState(q.skill || '');
  const [inPool, setInPool] = useState(q.in_pool);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    await api.put(`/api/admin/questions/${q.id}`, { correct, domain, skill, inPool });
    onSaved();
  };
  const explain = async () => {
    setBusy(true);
    setError('');
    try {
      onSaved(await api.post(`/api/admin/questions/${q.id}/explain`));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={2}>
      <QuestionView question={q} review answer={null} />
      <Stack direction="row" spacing={2} alignItems="center">
        <Button variant="outlined" color="secondary" startIcon={<MrAiIcon />} onClick={explain} disabled={busy || !q.correct}>
          {busy ? 'Mr AI is writing...' : q.rationale_html ? 'Rewrite explanation with Mr AI' : 'Write explanation with Mr AI'}
        </Button>
        {!q.correct && <Typography variant="body2" color="text.secondary">Save an answer first</Typography>}
      </Stack>
      {busy && <LinearProgress color="secondary" />}
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Grid container spacing={2} alignItems="center">
        <Grid item xs={12} md={3}>
          <TextField fullWidth size="small" label="Correct answer(s)" helperText="Letter or numbers, comma separated" value={correct} onChange={(e) => setCorrect(e.target.value)} />
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField fullWidth size="small" label="Domain" value={domain} onChange={(e) => setDomain(e.target.value)} />
        </Grid>
        <Grid item xs={12} md={3}>
          <TextField fullWidth size="small" label="Skill" value={skill} onChange={(e) => setSkill(e.target.value)} />
        </Grid>
        <Grid item xs={12} md={2}>
          <FormControlLabel control={<Checkbox checked={inPool} onChange={(e) => setInPool(e.target.checked)} />} label="In database" />
        </Grid>
        <Grid item xs={12} md={1}>
          <Button variant="contained" onClick={save} startIcon={<SaveIcon />}>Save</Button>
        </Grid>
      </Grid>
    </Stack>
  );
}

function BankTab() {
  const [bank, setBank] = useState(null);
  const [error, setError] = useState('');
  const [list, setList] = useState({ total: 0, items: [] });
  const [filters, setFilters] = useState({ section: '', source: '', missing: '', search: '' });
  const [page, setPage] = useState(0);
  const timer = useRef(null);
  const load = () => api.get('/api/admin/bank').then(setBank);
  const updateItem = (q) => setList((l) => ({ ...l, items: l.items.map((x) => (x.id === q.id ? q : x)) }));
  const loadList = () => {
    const p = new URLSearchParams({ page, size: 20, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    api.get(`/api/admin/questions?${p}`).then(setList);
  };
  useEffect(() => {
    load();
    timer.current = setInterval(load, 2000);
    return () => clearInterval(timer.current);
  }, []);
  useEffect(() => {
    loadList();
  }, [page, filters]);
  const stop = async (name) => {
    try {
      await api.post(`/api/admin/jobs/${name}/stop`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const start = async (name) => {
    setError('');
    try {
      await api.post(`/api/admin/jobs/${name}`);
      load();
    } catch (e) {
      setError(e.message);
    }
  };
  const sum = (fn) => (bank?.rows || []).filter(fn).reduce((s, r) => s + r.n, 0);
  return (
    <Stack spacing={2}>
      {error && <Alert severity="error" onClose={() => setError('')}>{error}</Alert>}
      <Grid container spacing={2}>
        {[
          ['Questions in database', sum((r) => r.in_pool)],
          ['Reading and Writing', sum((r) => r.in_pool && r.section === 'rw')],
          ['Math', sum((r) => r.in_pool && r.section === 'math')],
          ['Without an answer', bank?.missingAnswers ?? 0],
          ['Without a category', bank?.missingCategories ?? 0],
          ['PDF questions on the old version', bank?.oldPdf ?? 0],
        ].map(([label, n]) => (
          <Grid item xs={6} md={2} key={label}>
            <Paper sx={{ p: 2 }}>
              <Typography variant="body2" color="text.secondary">{label}</Typography>
              <Typography variant="h4" fontWeight={700}>{n}</Typography>
            </Paper>
          </Grid>
        ))}
      </Grid>
      <Grid container spacing={2}>
        <Grid item xs={12} md={6}>
          <JobCard
            title="College Board question bank"
            description="Downloads every question from the official SAT Suite Question Bank, with answers, explanations and categories. Questions already in the database are skipped."
            icon={<CloudDownloadIcon color="primary" />}
            job={bank?.jobs?.collegeboard}
            onStart={() => start('collegeboard')}
            onStop={() => stop('collegeboard')}
            buttonLabel="Fetch all questions"
          />
        </Grid>
        <Grid item xs={12} md={6}>
          <JobCard
            title="Generate missing answers and categories"
            description={`Fills in every question that has no answer or no category (${bank?.missingAnswers ?? 0} without an answer, ${bank?.missingCategories ?? 0} without a category). JEV gives each question its category, skill and difficulty, and answers multiple choice questions. Typed answers and questions that need their pictures go to the LLM.`}
            extra={
              <FormControlLabel
                control={<Switch checked={!!bank?.autoFill} onChange={async (e) => { await api.put('/api/admin/ai', { autoFill: e.target.checked }); load(); }} />}
                label="Do this automatically for new questions"
              />
            }
            icon={<AutoFixHighIcon color="secondary" />}
            job={bank?.jobs?.answers}
            onStart={() => start('answers')}
            onStop={() => stop('answers')}
            buttonLabel="Fill in now"
          />
        </Grid>
        <Grid item xs={12}>
          <JobCard
            title="Generate missing explanations"
            description={`Mr AI writes an easy explanation for every question that has an answer but no explanation (${bank?.missingExplanations ?? '...'} right now). Students see a smiley in the corner of explanations written by Mr AI. ${bank?.aiExplanations ?? 0} explanations are written by Mr AI so far.`}
            icon={<DescriptionIcon color="secondary" />}
            job={bank?.jobs?.explanations}
            onStart={() => start('explanations')}
            onStop={() => stop('explanations')}
            buttonLabel="Generate explanations"
          />
        </Grid>
      </Grid>
      <Paper sx={{ p: 2 }}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TextField size="small" label="Search" InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }} value={filters.search} onChange={(e) => { setPage(0); setFilters({ ...filters, search: e.target.value }); }} />
          <TextField select size="small" label="Section" value={filters.section} onChange={(e) => { setPage(0); setFilters({ ...filters, section: e.target.value }); }} sx={{ minWidth: 180 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="rw">Reading and Writing</MenuItem>
            <MenuItem value="math">Math</MenuItem>
          </TextField>
          <TextField select size="small" label="Source" value={filters.source} onChange={(e) => { setPage(0); setFilters({ ...filters, source: e.target.value }); }} sx={{ minWidth: 160 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="collegeboard">College Board</MenuItem>
            <MenuItem value="pdf">PDF import</MenuItem>
          </TextField>
          <TextField select size="small" label="Missing" value={filters.missing} onChange={(e) => { setPage(0); setFilters({ ...filters, missing: e.target.value }); }} sx={{ minWidth: 180 }}>
            <MenuItem value="">Show all</MenuItem>
            <MenuItem value="answer">No answer</MenuItem>
            <MenuItem value="explanation">No explanation</MenuItem>
            <MenuItem value="category">No category</MenuItem>
            <MenuItem value="oldpdf">Old PDF version (pictures)</MenuItem>
          </TextField>
        </Stack>
        {list.items.map((q) => (
          <Accordion key={q.id} disableGutters TransitionProps={{ unmountOnExit: true }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%', minWidth: 0 }}>
                <Chip size="small" label={q.section === 'rw' ? 'R&W' : 'Math'} />
                <Chip size="small" variant="outlined" label={q.source === 'pdf' ? 'PDF' : 'College Board'} />
                {q.source === 'pdf' && (q.pdfVersion < (bank?.pdfReaderVersion ?? 2)
                  ? <Tooltip title="Imported with the old PDF reader, which turned a lot of text into pictures. Upload the PDF again to replace it."><Chip size="small" color="warning" variant="outlined" label="Old version" /></Tooltip>
                  : <Chip size="small" color="success" variant="outlined" label="Text version" />)}
                <DifficultyChip d={q.difficulty} />
                <Typography variant="body2" noWrap sx={{ flexGrow: 1 }}>{q.skill || q.domain || 'Uncategorized'}</Typography>
                {!q.rationale_html && <Chip size="small" variant="outlined" color="warning" label="No explanation" />}
                {q.correct ? <Chip size="small" color="success" label={`Answer ${q.correct.join(', ')}`} /> : <Chip size="small" color="warning" label="No answer" />}
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              <QuestionEditor key={q.rationale_html} q={q} onSaved={(updated) => (updated ? updateItem(updated) : loadList())} />
            </AccordionDetails>
          </Accordion>
        ))}
        <TablePagination component="div" count={list.total} page={page} onPageChange={(e, p) => setPage(p)} rowsPerPage={20} rowsPerPageOptions={[20]} />
      </Paper>
    </Stack>
  );
}

export default function AdminPage() {
  const [tab, setTab] = useState(0);
  return (
    <Stack spacing={3}>
      <Typography variant="h4" fontWeight={700}>Admin</Typography>
      <Tabs value={tab} onChange={(e, v) => setTab(v)}>
        <Tab icon={<PeopleIcon />} iconPosition="start" label="Users" />
        <Tab icon={<MrAiIcon />} iconPosition="start" label="Mr AI" />
        <Tab icon={<StorageIcon />} iconPosition="start" label="Question bank" />
      </Tabs>
      {tab === 0 && <UsersTab />}
      {tab === 1 && <AiTab />}
      {tab === 2 && <BankTab />}
    </Stack>
  );
}
