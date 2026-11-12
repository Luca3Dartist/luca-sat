import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Grid, Paper, Typography, Stack, Box, Button, Alert, Skeleton } from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import EmojiEventsIcon from '@mui/icons-material/EmojiEvents';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import CalculateIcon from '@mui/icons-material/Calculate';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import AddIcon from '@mui/icons-material/Add';
import { api, formatDate } from '../api.js';
import { useAuth } from '../auth.jsx';

function StatCard({ icon, label, value, hint, color }) {
  return (
    <Paper sx={{ p: 2.5, height: '100%' }}>
      <Stack direction="row" spacing={2} alignItems="center">
        <Box sx={{ bgcolor: `${color}.main`, color: `${color}.contrastText`, borderRadius: 2, p: 1.2, display: 'flex' }}>{icon}</Box>
        <Box>
          <Typography variant="body2" color="text.secondary">{label}</Typography>
          <Typography variant="h4" fontWeight={700}>{value ?? '-'}</Typography>
          {hint && <Typography variant="caption" color="text.secondary">{hint}</Typography>}
        </Box>
      </Stack>
    </Paper>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState(null);
  useEffect(() => {
    api.get('/api/stats').then(setStats).catch(() => setStats({ tests: [], average: {}, inProgress: 0 }));
  }, []);
  if (!stats) return <Skeleton variant="rounded" height={400} />;
  const tests = stats.tests;
  return (
    <Stack spacing={3}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Box>
          <Typography variant="h4" fontWeight={700}>Welcome back, {user.username.charAt(0).toUpperCase() + user.username.slice(1)}</Typography>
          <Typography color="text.secondary">Cook another test today?</Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          {stats.inProgress > 0 && (
            <Button variant="outlined" startIcon={<PlayArrowIcon />} onClick={() => navigate('/sats')}>
              {stats.inProgress} unfinished
            </Button>
          )}
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => navigate('/sats?new=1')}>New SAT</Button>
        </Stack>
      </Stack>
      <Grid container spacing={2}>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<TrendingUpIcon />} color="primary" label="Average score" value={stats.average.total} hint={`${tests.length} finished test${tests.length === 1 ? '' : 's'}`} />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<EmojiEventsIcon />} color="warning" label="Best score" value={stats.best} hint="Out of 1600" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<MenuBookIcon />} color="secondary" label="Reading and Writing" value={stats.average.rw} hint="Average, out of 800" />
        </Grid>
        <Grid item xs={12} sm={6} md={3}>
          <StatCard icon={<CalculateIcon />} color="success" label="Math" value={stats.average.math} hint="Average, out of 800" />
        </Grid>
      </Grid>
      <Paper sx={{ p: 3 }}>
        <Typography variant="h6" fontWeight={700} gutterBottom>Your scores</Typography>
        {tests.length === 0 ? (
          <Alert severity="info" action={<Button onClick={() => navigate('/sats?new=1')}>Start one</Button>}>
            Take one test first.
          </Alert>
        ) : (
          <Box sx={{ height: 340 }}>
            <LineChart
              xAxis={[{ scaleType: 'point', data: tests.map((t, i) => `#${i + 1}`), valueFormatter: (v, ctx) => (ctx.location === 'tooltip' ? `${v} ${tests[Number(String(v).slice(1)) - 1]?.title || ''} (${formatDate(tests[Number(String(v).slice(1)) - 1]?.finishedAt)})` : v) }]}
              yAxis={[{ min: 200, max: 1600 }]}
              series={[
                { data: tests.map((t) => t.total), label: 'Total', color: '#1d4ed8', connectNulls: true },
                { data: tests.map((t) => t.rw), label: 'Reading and Writing', color: '#7c3aed', connectNulls: true },
                { data: tests.map((t) => t.math), label: 'Math', color: '#16a34a', connectNulls: true },
              ]}
              margin={{ left: 50, right: 20, top: 50, bottom: 30 }}
            />
          </Box>
        )}
      </Paper>
    </Stack>
  );
}
