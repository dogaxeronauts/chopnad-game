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
git clone https://github.com/dogaxeronauts/chopnad-game.git
cd chopnad-game
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

---

## Gameplay Guide

**Objective:**  
Chop the required vegetables for each order as quickly and accurately as possible. Deliver orders before time runs out to earn bonus points.

### How to Play

- **Move Chef:** Use `A`/`D` or `ArrowLeft`/`ArrowRight` to move the chef left and right.
- **Chop:** Press `Space` or click to chop the vegetable in front of the chef.
- **Combo Bonus:** Chopping consecutive correct vegetables increases your combo and bonus points.
- **Wrong Chop:** Chopping the wrong vegetable or rotten ones decreases your score and resets your combo.
- **Knife Power-Up:** Chop the knife to activate a power-up for faster chopping.
- **Delivery Bonus:** Delivering an order before time runs out grants extra points.

### Scoring

- Each vegetable has a score value. Chop the required amount for each order.
- Order Score = Sum of (Vegetable Score × Required Amount) for all items in the order.
- Combo Bonus: Chopping consecutive correct vegetables increases your combo and bonus points.
- Wrong chop or rotten vegetables decrease your score and reset your combo.
- Delivery Bonus: Delivering an order before time runs out grants extra points.

### Difficulty

- The game gets harder as you progress: more vegetables, faster belt, more rotten and power-up items.
- Anger level increases if you make mistakes, affecting game speed and scoring.

## Contributing

Pull requests and feedback are welcome!

## License

MIT