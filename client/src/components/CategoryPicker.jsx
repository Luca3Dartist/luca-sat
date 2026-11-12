import { useEffect, useMemo, useState } from 'react';
import { Box, Stack, Typography, Checkbox, FormControlLabel, Collapse, IconButton, Paper, LinearProgress, Button } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { api } from '../api.js';

export const DIFFICULTIES = [
  { key: 'E', label: 'Easy' },
  { key: 'M', label: 'Medium' },
  { key: 'H', label: 'Hard' },
  { key: 'none', label: 'Not rated' },
];

function DomainGroup({ domain, skills, selected, setSelected, difficulties }) {
  const [open, setOpen] = useState(false);
  const keys = skills.map((s) => s.key);
  const on = keys.filter((k) => selected.includes(k)).length;
  const count = (s) => difficulties.reduce((n, d) => n + (s.byDifficulty[d] || 0), 0);
  const toggleAll = () => setSelected((sel) => (on === keys.length ? sel.filter((k) => !keys.includes(k)) : [...new Set([...sel, ...keys])]));
  return (
    <Box>
      <Stack direction="row" alignItems="center">
        <Checkbox size="small" checked={on === keys.length} indeterminate={on > 0 && on < keys.length} onChange={toggleAll} />
        <Typography fontWeight={600} sx={{ flexGrow: 1 }}>{domain}</Typography>
        <Typography variant="caption" color="text.secondary">{skills.reduce((n, s) => n + count(s), 0)}</Typography>
        <IconButton size="small" onClick={() => setOpen((o) => !o)}>{open ? <ExpandLessIcon /> : <ExpandMoreIcon />}</IconButton>
      </Stack>
      <Collapse in={open}>
        <Stack sx={{ pl: 4 }}>
          {skills.map((s) => (
            <FormControlLabel
              key={s.key}
              control={<Checkbox size="small" checked={selected.includes(s.key)} onChange={() => setSelected((sel) => (sel.includes(s.key) ? sel.filter((k) => k !== s.key) : [...sel, s.key]))} />}
              label={<Typography variant="body2">{s.skill} <Typography component="span" variant="caption" color="text.secondary">({count(s)})</Typography></Typography>}
            />
          ))}
        </Stack>
      </Collapse>
    </Box>
  );
}

export default function CategoryPicker({ bankOnly, sections, value, onChange }) {
  const [cats, setCats] = useState(null);
  const [selected, setSelected] = useState([]);
  const [difficulties, setDifficulties] = useState(DIFFICULTIES.map((d) => d.key));

  useEffect(() => {
    setCats(null);
    api.get(`/api/categories?bankOnly=${!!bankOnly}`).then((c) => {
      setCats(c);
      setSelected(c.map((x) => x.key));
    });
  }, [bankOnly]);

  useEffect(() => {
    if (cats) onChange({ skills: selected, difficulties });
  }, [selected, difficulties, cats]);

  const groups = useMemo(() => {
    const out = {};
    for (const c of cats || []) {
      if (!sections.includes(c.section)) continue;
      out[c.section] = out[c.section] || {};
      out[c.section][c.domain] = out[c.section][c.domain] || [];
      out[c.section][c.domain].push(c);
    }
    return out;
  }, [cats, sections]);

  const matching = useMemo(() => (cats || []).filter((c) => selected.includes(c.key) && sections.includes(c.section)).reduce((n, c) => n + difficulties.reduce((m, d) => m + (c.byDifficulty[d] || 0), 0), 0), [cats, selected, difficulties, sections]);

  if (!cats) return <LinearProgress />;
  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography fontWeight={600} gutterBottom>Difficulty</Typography>
      <Stack direction="row" flexWrap="wrap" sx={{ mb: 1 }}>
        {DIFFICULTIES.map((d) => (
          <FormControlLabel key={d.key} control={<Checkbox size="small" checked={difficulties.includes(d.key)} onChange={() => setDifficulties((ds) => (ds.includes(d.key) ? ds.filter((x) => x !== d.key) : [...ds, d.key]))} />} label={d.label} />
        ))}
      </Stack>
      <Stack direction="row" alignItems="center" sx={{ mb: 1 }}>
        <Typography fontWeight={600} sx={{ flexGrow: 1 }}>Categories</Typography>
        <Button size="small" onClick={() => setSelected(cats.map((c) => c.key))}>All</Button>
        <Button size="small" onClick={() => setSelected([])}>None</Button>
      </Stack>
      <Box sx={{ maxHeight: 280, overflowY: 'auto' }}>
        {['rw', 'math'].filter((s) => groups[s]).map((s) => (
          <Box key={s} sx={{ mb: 1 }}>
            <Typography variant="overline" color="text.secondary">{s === 'rw' ? 'Reading and Writing' : 'Math'}</Typography>
            {Object.entries(groups[s]).map(([domain, skills]) => (
              <DomainGroup key={domain} domain={domain} skills={skills} selected={selected} setSelected={setSelected} difficulties={difficulties} />
            ))}
          </Box>
        ))}
      </Box>
      <Typography variant="body2" color={matching ? 'text.secondary' : 'error'} sx={{ mt: 1 }}>
        {matching} questions match. Questions are still picked at random from these.
      </Typography>
    </Paper>
  );
}
