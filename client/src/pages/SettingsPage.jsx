import { useState } from 'react';
import { Stack, Typography, Paper, TextField, Button, Alert, Switch, FormControlLabel, Box, Chip, LinearProgress } from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import WallpaperIcon from '@mui/icons-material/Wallpaper';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import LockResetIcon from '@mui/icons-material/LockReset';
import KeyIcon from '@mui/icons-material/Key';
import BlockIcon from '@mui/icons-material/Block';
import MrAiIcon from '@mui/icons-material/SentimentSatisfiedAlt';
import { api } from '../api.js';
import { useAuth } from '../auth.jsx';
import { useColorMode } from '../colorMode.js';

export default function SettingsPage() {
  const { user, setUser } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [pwMsg, setPwMsg] = useState(null);
  const { mode, toggle, glass, setGlass } = useColorMode();
  const [bgBusy, setBgBusy] = useState(false);
  const [bgMsg, setBgMsg] = useState(null);

  const uploadBg = async (file) => {
    if (!file) return;
    setBgBusy(true);
    setBgMsg(null);
    try {
      const fd = new FormData();
      fd.append('image', file);
      setUser(await api.form('/api/me/background', fd));
    } catch (e) {
      setBgMsg(e.message);
    } finally {
      setBgBusy(false);
    }
  };

  const changePassword = async () => {
    try {
      await api.put('/api/me/password', { current, next });
      setPwMsg({ type: 'success', text: 'Password changed' });
      setCurrent('');
      setNext('');
    } catch (e) {
      setPwMsg({ type: 'error', text: e.message });
    }
  };

  const setHate = async (v) => setUser(await api.put('/api/me/settings', { hateAi: v }));

  const aiLabel = user.ai?.enabled ? 'Mr AI is on' : user.hateAi ? 'Mr AI is turned off' : 'Mr AI is not available until an admin sets it up';

  return (
    <Stack spacing={3} sx={{ maxWidth: 640 }}>
      <Typography variant="h4" fontWeight={700}>Settings</Typography>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <PaletteIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>Appearance</Typography>
        </Stack>
        <Stack>
          <FormControlLabel control={<Switch checked={mode === 'dark'} onChange={toggle} />} label="Dark mode" />
          <FormControlLabel control={<Switch checked={glass} onChange={(e) => setGlass(e.target.checked)} />} label="Liquid glass interface" />
        </Stack>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 2 }}>
          Liquid glass bends and blurs your background behind every card. It looks best with a background picture.
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Box
            sx={{
              width: 160,
              height: 90,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              backgroundImage: user.background ? `url("${user.background}")` : 'none',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              display: 'grid',
              placeItems: 'center',
              color: 'text.secondary',
              flexShrink: 0,
            }}
          >
            {!user.background && <WallpaperIcon />}
          </Box>
          <Stack spacing={1}>
            <Button component="label" variant="contained" startIcon={<WallpaperIcon />} disabled={bgBusy}>
              {user.background ? 'Change background' : 'Upload background'}
              <input hidden type="file" accept="image/png,image/jpeg,image/gif,image/webp" onChange={(e) => uploadBg(e.target.files?.[0])} />
            </Button>
            {user.background && (
              <Button color="error" startIcon={<DeleteOutlineIcon />} onClick={async () => setUser(await api.del('/api/me/background'))}>
                Remove background
              </Button>
            )}
            <Typography variant="caption" color="text.secondary">Pictures and GIFs up to 25 MB. It is cropped to fill the screen.</Typography>
          </Stack>
        </Stack>
        {bgBusy && <LinearProgress sx={{ mt: 2 }} />}
        {bgMsg && <Alert severity="error" sx={{ mt: 2 }}>{bgMsg}</Alert>}
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <BlockIcon color="error" />
          <Typography variant="h6" fontWeight={700}>I HATE AI</Typography>
        </Stack>
        <FormControlLabel control={<Switch checked={user.hateAi} onChange={(e) => setHate(e.target.checked)} color="error" />} label="Turn off Mr AI completely for my account" />
      </Paper>

      <Paper sx={{ p: 3, opacity: user.hateAi ? 0.5 : 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
          <MrAiIcon color="secondary" />
          <Typography variant="h6" fontWeight={700}>Mr AI</Typography>
        </Stack>
        <Chip label={aiLabel} color={user.ai?.enabled ? 'success' : 'default'} sx={{ maxWidth: '100%' }} />
      </Paper>

      <Paper sx={{ p: 3 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
          <KeyIcon color="primary" />
          <Typography variant="h6" fontWeight={700}>Change password</Typography>
        </Stack>
        <Stack spacing={2}>
          <TextField type="password" label="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          <TextField type="password" label="New password" value={next} onChange={(e) => setNext(e.target.value)} />
          <Box>
            <Button variant="contained" startIcon={<LockResetIcon />} onClick={changePassword}>Change password</Button>
          </Box>
          {pwMsg && <Alert severity={pwMsg.type}>{pwMsg.text}</Alert>}
        </Stack>
      </Paper>
    </Stack>
  );
}
