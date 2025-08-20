export type FriendsBets = {
  "version": "0.1.0",
  "name": "friends_bets",
  "address": "BtNtmmrm3KHc5EmvednmUv43hxL8P3S2fsfPVpffx1Rt",
  "metadata": {
    "name": "friends_bets",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "cancelExpired",
      "discriminator": number[],
      "accounts": any[],
      "args": []
    },
    {
      "name": "claim",
      "discriminator": number[],
      "accounts": any[],
      "args": []
    },
    {
      "name": "closeBetting",
      "discriminator": number[],
      "accounts": any[],
      "args": []
    },
    {
      "name": "initializeMarket",
      "discriminator": number[],
      "accounts": any[],
      "args": any[]
    },
    {
      "name": "placeBet",
      "discriminator": number[],
      "accounts": any[],
      "args": any[]
    },
    {
      "name": "resolve",
      "discriminator": number[],
      "accounts": any[],
      "args": any[]
    },
    {
      "name": "withdrawCreatorFee",
      "discriminator": number[],
      "accounts": any[],
      "args": []
    }
  ],
  "accounts": [
    {
      "name": "Market",
      "discriminator": number[]
    },
    {
      "name": "Position",
      "discriminator": number[]
    }
  ],
  "events": any[],
  "errors": any[],
  "types": [
    {
      "name": "BetPlaced",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "BetSide",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "A"
          },
          {
            "name": "B"
          }
        ]
      }
    },
    {
      "name": "BettingClosed",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "Cancelled",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "Claimed",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "CreatorFeeWithdrawn",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "Market",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "MarketInitialized",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "MarketStatus",
      "type": {
        "kind": "enum",
        "variants": any[]
      }
    },
    {
      "name": "Position",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    },
    {
      "name": "Resolved",
      "type": {
        "kind": "struct",
        "fields": any[]
      }
    }
  ]
};