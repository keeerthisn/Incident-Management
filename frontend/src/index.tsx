import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import App from './App';

// ── N-able brand palette (matches N-tranet) ───────────────────────────────────
// Nav bar  #1A1A2E   Purple accent  #5B2D91   Vivid purple  #7C3AED
// Lavender bg  #ECEAF6   Paper  #FFFFFF
const PURPLE_DEEP   = '#5B2D91';
const PURPLE_VIVID  = '#7C3AED';
const NAV_DARK      = '#1A1A2E';
const BG_LAVENDER   = '#ECEAF6';

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: PURPLE_DEEP,
      light: PURPLE_VIVID,
      dark: '#3D1A6E',
      contrastText: '#FFFFFF',
    },
    secondary: {
      main: PURPLE_VIVID,
      light: '#9B6EF3',
      dark: PURPLE_DEEP,
      contrastText: '#FFFFFF',
    },
    background: {
      default: BG_LAVENDER,
      paper: '#FFFFFF',
    },
    text: {
      primary: '#1A1A2E',
      secondary: '#4A4A6A',
    },
    error:   { main: '#E53E3E' },
    warning: { main: '#DD6B20' },
    success: { main: '#276749' },
    info:    { main: '#2B6CB0' },
    divider: '#D8D4EC',
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  shape: { borderRadius: 8 },
  components: {
    MuiButton: {
      styleOverrides: {
        root: { borderRadius: 20 },
        containedPrimary: {
          background: `linear-gradient(135deg, ${PURPLE_DEEP} 0%, ${PURPLE_VIVID} 100%)`,
          '&:hover': { background: `linear-gradient(135deg, #3D1A6E 0%, ${PURPLE_DEEP} 100%)` },
        },
        outlinedPrimary: {
          borderColor: PURPLE_DEEP,
          color: PURPLE_DEEP,
          '&:hover': { borderColor: PURPLE_VIVID, color: PURPLE_VIVID, bgcolor: 'rgba(91,45,145,0.05)' },
        },
      },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 20, fontWeight: 500 } },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          boxShadow: '0 2px 8px rgba(91,45,145,0.10)',
          borderRadius: 12,
        },
      },
    },
    MuiTableHead: {
      styleOverrides: {
        root: {
          '& .MuiTableCell-head': {
            background: `linear-gradient(90deg, ${NAV_DARK} 0%, ${PURPLE_DEEP} 100%)`,
            color: '#FFFFFF',
            fontWeight: 600,
            fontSize: '0.78rem',
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          },
        },
      },
    },
    MuiLinearProgress: {
      styleOverrides: {
        bar: { background: `linear-gradient(90deg, ${PURPLE_DEEP}, ${PURPLE_VIVID})` },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: { bgcolor: NAV_DARK },
      },
    },
  },
});

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <BrowserRouter>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <App />
      </ThemeProvider>
    </BrowserRouter>
  </React.StrictMode>
);