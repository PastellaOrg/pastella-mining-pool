# Pastella Mining Pool Frontend

A modern, responsive mining pool frontend built with Vite + React, matching the design of the Pastella explorer.

## Features

- **Real-time Stats**: Live pool statistics via WebSocket/EventSource
- **Miner Dashboard**: Individual miner stats with worker breakdown
- **Blocks Tracking**: View all blocks found by the pool
- **Payments History**: Complete payment history with transaction links
- **Top Miners**: Leaderboard showing top miners by hashrate
- **Responsive Design**: Works perfectly on desktop, tablet, and mobile
- **Dark Theme**: Beautiful dark UI matching the Pastella explorer aesthetic

## Prerequisites

- Node.js 18+ and npm/yarn/pnpm

## Installation

1. Install dependencies:
```bash
npm install
```

2. Configure the pool API endpoint in `src/config/pool.ts`:
```typescript
api: 'http://192.168.1.172:8001',  // Update with your pool API URL
```

3. Start the development server:
```bash
npm run dev
```

4. Build for production:
```bash
npm run build
```

## Configuration

Edit `src/config/pool.ts` to customize:

- Pool name and coin ticker
- API endpoint
- Pool settings (fee, min payout, ports)
- Algorithm type

## Pages

- **/** - Dashboard with pool stats and recent activity
- **/miner/:address** - Individual miner statistics
- **/blocks** - All blocks found by the pool
- **/payments** - Complete payment history
- **/top** - Top miners leaderboard

## Technologies Used

- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool and dev server
- **React Router** - Routing
- **Bootstrap 5** - UI components
- **Font Awesome** - Icons
- **Moment.js** - Date/time formatting

## API Integration

The frontend connects to the Cryptonote Node.js Pool API endpoints:

- `/stats` - Pool statistics
- `/live_stats` - Real-time stats stream
- `/stats_address` - Miner stats
- `/get_blocks` - Block data
- `/get_payments` - Payment data
- `/get_top10miners` - Top miners

## Deployment

1. Build the project:
```bash
npm run build
```

2. The built files will be in the `dist/` directory

3. Serve with any static file server (nginx, Apache, etc.)

Example nginx config:
```nginx
server {
    listen 80;
    server_name pool.yourdomain.com;
    root /path/to/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    # Proxy API requests to the pool backend
    location /api/ {
        proxy_pass http://localhost:8001/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## Development

- Run dev server: `npm run dev`
- Run linter: `npm run lint`
- Preview production build: `npm run preview`

## License

MIT License - feel free to use and modify for your own mining pool!
