import { useEffect, useRef, useState } from 'react';
import { Box, Stack, Tabs, Tab, TextField, MenuItem, Checkbox, Typography, Chip, IconButton, Collapse, TablePagination, Accordion, AccordionSummary, AccordionDetails, Button, LinearProgress, Paper, Alert } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import StorageIcon from '@mui/icons-material/Storage';
import AssignmentIcon from '@mui/icons-material/Assignment';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import { api, formatDate } from '../api.js';
import QuestionView, { DifficultyChip } from './QuestionView.jsx';

function Row({ q, list, checked, onToggle, full }) {
  const [open, setOpen] = useState(false);
  return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', py: 0.5 }}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Checkbox checked={checked} onChange={() => {}} onClick={(e) => onToggle(q, e, list)} />
        <Chip size="small" label={q.section === 'rw' ? 'R&W' : 'Math'} />
        <DifficultyChip d={q.difficulty} />
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="body2" noWrap>{q.snippet || 'Question shown as an image'}</Typography>
          <Typography variant="caption" color="text.secondary" noWrap>{q.skill || q.domain || 'Uncategorized'}</Typography>
        </Box>
        {full && (
          <IconButton size="small" onClick={() => setOpen((o) => !o)}>{open ? <VisibilityOffIcon /> : <VisibilityIcon />}</IconButton>
        )}
      </Stack>
      {full && (
        <Collapse in={open} unmountOnExit>
          <Box sx={{ p: 2 }}>
            <QuestionView question={q} answer={null} review />
          </Box>
        </Collapse>
      )}
    </Box>
  );
}

function DatabaseTab({ selected, toggle }) {
  const [filters, setFilters] = useState({ search: '', section: '', domain: '', difficulty: '', source: '' });
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [domains, setDomains] = useState([]);
  useEffect(() => {
    api.get('/api/categories').then((c) => setDomains([...new Set(c.map((x) => `${x.section}|${x.domain}`))]));
  }, []);
  useEffect(() => {
    const p = new URLSearchParams({ page, size: 20, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) });
    setData(null);
    const t = setTimeout(() => api.get(`/api/questions?${p}`).then(setData), 250);
    return () => clearTimeout(t);
  }, [filters, page]);
  const set = (k) => (e) => {
    setPage(0);
    setFilters({ ...filters, [k]: e.target.value, ...(k === 'section' ? { domain: '' } : {}) });
  };
  return (
    <Stack spacing={1}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1}>
        <TextField size="small" placeholder="Search text" value={filters.search} onChange={set('search')} InputProps={{ startAdornment: <SearchIcon sx={{ mr: 1, color: 'text.secondary' }} /> }} sx={{ flexGrow: 1 }} />
        <TextField select size="small" label="Section" value={filters.section} onChange={set('section')} sx={{ minWidth: 150 }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="rw">Reading and Writing</MenuItem>
          <MenuItem value="math">Math</MenuItem>
        </TextField>
        <TextField select size="small" label="Category" value={filters.domain} onChange={set('domain')} sx={{ minWidth: 180 }}>
          <MenuItem value="">All</MenuItem>
          {domains.filter((d) => !filters.section || d.startsWith(filters.section + '|')).map((d) => d.split('|')[1]).filter((d) => d !== 'Uncategorized').map((d) => (
            <MenuItem key={d} value={d}>{d}</MenuItem>
          ))}
        </TextField>
        <TextField select size="small" label="Difficulty" value={filters.difficulty} onChange={set('difficulty')} sx={{ minWidth: 120 }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="E">Easy</MenuItem>
          <MenuItem value="M">Medium</MenuItem>
          <MenuItem value="H">Hard</MenuItem>
        </TextField>
        <TextField select size="small" label="Source" value={filters.source} onChange={set('source')} sx={{ minWidth: 140 }}>
          <MenuItem value="">All</MenuItem>
          <MenuItem value="collegeboard">Question bank</MenuItem>
          <MenuItem value="pdf">Imported PDFs</MenuItem>
        </TextField>
      </Stack>
      {!data ? (
        <LinearProgress />
      ) : (
        <Box>
          {data.items.map((q) => <Row key={q.id} q={q} list={data.items} full checked={selected.has(q.id)} onToggle={toggle} />)}
          {data.items.length === 0 && <Alert severity="info">No questions match.</Alert>}
          <TablePagination component="div" count={data.total} page={page} onPageChange={(e, p) => setPage(p)} rowsPerPage={20} rowsPerPageOptions={[20]} />
        </Box>
      )}
    </Stack>
  );
}

function TestsTab({ selected, toggle, toggleMany }) {
  const [tests, setTests] = useState(null);
  useEffect(() => {
    api.get('/api/my-test-questions').then(setTests);
  }, []);
  if (!tests) return <LinearProgress />;
  if (!tests.length) return <Alert severity="info">You have no tests yet.</Alert>;
  return (
    <Box>
      {tests.map((t) => {
        const all = t.modules.flatMap((m) => m.questions);
        const count = all.filter((q) => selected.has(q.id)).length;
        return (
          <Accordion key={t.id} disableGutters TransitionProps={{ unmountOnExit: true }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ width: '100%' }}>
                <Typography fontWeight={600} sx={{ flexGrow: 1 }}>{t.title}</Typography>
                <Chip size="small" label={t.shareCode} variant="outlined" />
                <Typography variant="caption" color="text.secondary">{formatDate(t.createdAt)}</Typography>
                <Chip size="small" color={count ? 'primary' : 'default'} label={`${count}/${all.length}`} />
              </Stack>
            </AccordionSummary>
            <AccordionDetails>
              {t.modules.map((m, i) => (
                <Box key={i} sx={{ mb: 1 }}>
                  <Stack direction="row" alignItems="center">
                    <Typography variant="overline" sx={{ flexGrow: 1 }}>{m.title}</Typography>
                    <Button size="small" startIcon={<DoneAllIcon />} onClick={() => toggleMany(m.questions, !m.questions.every((q) => selected.has(q.id)))}>
                      {m.questions.every((q) => selected.has(q.id)) ? 'Unselect all' : 'Select all'}
                    </Button>
                  </Stack>
                  {m.questions.map((q) => <Row key={q.id} q={q} list={m.questions} checked={selected.has(q.id)} onToggle={toggle} />)}
                </Box>
              ))}
            </AccordionDetails>
          </Accordion>
        );
      })}
    </Box>
  );
}

export default function QuestionPicker({ selected, setSelected }) {
  const [tab, setTab] = useState(0);
  const last = useRef(null);
  const toggle = (q, e, list) => {
    const prev = last.current;
    last.current = { id: q.id, list };
    if (e?.shiftKey && prev && prev.list === list) {
      const a = list.findIndex((x) => x.id === prev.id);
      const b = list.findIndex((x) => x.id === q.id);
      if (a >= 0 && b >= 0) {
        const range = list.slice(Math.min(a, b), Math.max(a, b) + 1);
        setSelected((s) => {
          const next = new Map(s);
          const on = !s.has(q.id);
          for (const x of range) {
            if (on) next.set(x.id, x.section);
            else next.delete(x.id);
          }
          return next;
        });
        return;
      }
    }
    setSelected((s) => {
      const next = new Map(s);
      if (next.has(q.id)) next.delete(q.id);
      else next.set(q.id, q.section);
      return next;
    });
  };
  const toggleMany = (qs, on) =>
    setSelected((s) => {
      const next = new Map(s);
      for (const q of qs) {
        if (on) next.set(q.id, q.section);
        else next.delete(q.id);
      }
      return next;
    });
  const rw = [...selected.values()].filter((v) => v === 'rw').length;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="caption" color="text.secondary">Tip: hold Shift and click a second checkbox to select everything in between.</Typography>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Tabs value={tab} onChange={(e, v) => setTab(v)} sx={{ flexGrow: 1 }}>
          <Tab icon={<StorageIcon />} iconPosition="start" label="Question database" />
          <Tab icon={<AssignmentIcon />} iconPosition="start" label="From my tests" />
        </Tabs>
        <Chip color="primary" label={`${selected.size} picked (${rw} R&W, ${selected.size - rw} Math)`} />
        {selected.size > 0 && <Button size="small" onClick={() => setSelected(new Map())}>Clear</Button>}
      </Stack>
      <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
        {tab === 0 ? <DatabaseTab selected={selected} toggle={toggle} /> : <TestsTab selected={selected} toggle={toggle} toggleMany={toggleMany} />}
      </Box>
    </Paper>
  );
}
