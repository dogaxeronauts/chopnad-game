# ChopUpNad

ChopUpNad is a fast-paced kitchen game built with Next.js, featuring blockchain-based score tracking and wallet authentication via Privy.

## Features

- Next.js + React + TypeScript
- Dynamic difficulty system
- Blockchain score and transaction tracking
- Wallet authentication with Privy
- Real-time toast notifications
- Responsive, modern UI

## Setup

```bash
git clone https://github.com/<your-repo>/mission7-example-game.git
cd mission7-example-game
npm install
```

## Development

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Environment Variables

Create a `.env` file and add:

```
NEXT_PUBLIC_PRIVY_APP_ID=<Your Privy App ID>
NEXT_PUBLIC_APP_URL=<Your App URL>
```

## Gameplay

1. Log in with your Monad Games ID (wallet).
2. Chop the correct vegetables to earn points.
3. Deliver orders on time for bonus points.
4. Track your stats and transactions on the blockchain.

## Deployment

You can deploy easily with Vercel. See [DEPLOYMENT.md](mission7-example-game/DEPLOYMENT.md) for details.

## Contributing

Pull requests and feedback are welcome!

## License

MIT