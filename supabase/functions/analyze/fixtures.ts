import type { AnalyzeRequest } from "./types.ts";

export const FIXTURES: Record<string, { pass: AnalyzeRequest; fail: AnalyzeRequest }> = {
  // --- FUNDAMENTALS 1: Calculate Absolute ---
  calculate_absolute: {
    pass: {
      meta: { title: "Calculate Absolute", name: "calculate_absolute", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `calculate_absolute(n: int) -> int` that takes an integer `n` as input and returns its absolute value.",
      starter: "",
      io: [],
      code: "def calculate_absolute(n):\n    if n < 0:\n        return n * -1\n    return n",
      testReport: [{ input: "[-5]", expected: "5", actual: "5", equal: true }, { input: "[7]", expected: "7", actual: "7", equal: true }]
    },
    fail: {
      meta: { title: "Calculate Absolute", name: "calculate_absolute", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `calculate_absolute(n: int) -> int` that takes an integer `n` as input and returns its absolute value.",
      starter: "",
      io: [],
      code: "def calculate_absolute(n):\n    return n",
      testReport: [{ input: "[-5]", expected: "5", actual: "5", equal: true }, { input: "[7]", expected: "7", actual: "7", equal: true }]
    }
  },
  
  // --- FUNDAMENTALS 2: Makes Ten ---
  makes_ten: {
    pass: {
      meta: { title: "Makes Ten", name: "makes_ten", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `makes_ten(a: int, b: int) -> bool` that takes two integer inputs, `a` and `b`. The function should return `True` if either of the integers is `10`, or if their sum is `10`.",
      starter: "",
      io: [],
      code: "def makes_ten(a, b):\n    return a == 10 or b == 10 or a + b == 10",
      testReport: [{ input: "[7, 3]", expected: "true", actual: "true", equal: true }, { input: "[10, 5]", expected: "true", actual: "true", equal: true }, { input: "[2, 3]", expected: "false", actual: "false", equal: true }]
    },
    fail: {
      meta: { title: "Makes Ten", name: "makes_ten", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `makes_ten(a: int, b: int) -> bool` that takes two integer inputs, `a` and `b`. The function should return `True` if either of the integers is `10`, or if their sum is `10`.",
      starter: "",
      io: [],
      code: "def makes_ten(a, b):\n    return a + b == 10", // Fails to check if a or b alone is 10
      testReport: [{ input: "[7, 3]", expected: "true", actual: "true", equal: true }, { input: "[10, 5]", expected: "true", actual: "false", equal: false }]
    }
  },

  // --- FUNDAMENTALS 3: Is Even ---
  is_even: {
    pass: {
      meta: { title: "Is Even", name: "is_even", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `is_even(n: int) -> bool` that takes an integer `n` as input and returns `True` if the integer is even, and `False` otherwise.",
      starter: "",
      io: [],
      code: "def is_even(n):\n    return n % 2 == 0",
      testReport: [{ input: "[4]", expected: "true", actual: "true", equal: true }, { input: "[5]", expected: "false", actual: "false", equal: true }]
    },
    fail: {
      meta: { title: "Is Even", name: "is_even", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `is_even(n: int) -> bool` that takes an integer `n` as input and returns `True` if the integer is even, and `False` otherwise.",
      starter: "",
      io: [],
      code: "def is_even(n):\n    return n % 2 == 1", // Checks for odd instead of even
      testReport: [{ input: "[4]", expected: "true", actual: "false", equal: false }]
    }
  },

  // --- FUNDAMENTALS 4: Minutes to Seconds ---
  minutes_to_seconds: {
    pass: {
      meta: { title: "Minutes to Seconds", name: "minutes_to_seconds", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `minutes_to_seconds(minutes: int) -> int` that takes a number of minutes and returns the equivalent number of seconds.",
      starter: "",
      io: [],
      code: "def minutes_to_seconds(minutes):\n    return minutes * 60",
      testReport: [{ input: "[1]", expected: "60", actual: "60", equal: true }, { input: "[3]", expected: "180", actual: "180", equal: true }]
    },
    fail: {
      meta: { title: "Minutes to Seconds", name: "minutes_to_seconds", category: "Fundamentals", question_type: ["coding"], difficulty: "easy", author: "ChatGPT" },
      description: "Write a function `minutes_to_seconds(minutes: int) -> int` that takes a number of minutes and returns the equivalent number of seconds.",
      starter: "",
      io: [],
      code: "def minutes_to_seconds(minutes):\n    return minutes * 100", // Wrong conversion factor
      testReport: [{ input: "[1]", expected: "60", actual: "100", equal: false }]
    }
  },

  // --- HAYSTACK 1: Compass Array ---
  compass_array: {
    pass: {
      meta: { title: "Compass Array Rotation", name: "decode_artifact", category: "List-1: Indexing", question_type: ["haystack"], difficulty: "medium", author: "ChatGPT, edited by Eric" },
      description: "In a windswept chamber beneath the desert... determine the correct reordering of the sequence based on a given number of clockwise shifts.",
      starter: "",
      io: [],
      code: "def decode_artifact(arr, n):\n    n = n % len(arr)\n    return arr[-n:] + arr[:-n]",
      testReport: [{ input: "[[17, 42, 8, 23, 5, 91, 34], 2]", expected: "[91, 34, 17, 42, 8, 23, 5]", actual: "[91, 34, 17, 42, 8, 23, 5]", equal: true }]
    },
    fail: {
      meta: { title: "Compass Array Rotation", name: "decode_artifact", category: "List-1: Indexing", question_type: ["haystack"], difficulty: "medium", author: "ChatGPT, edited by Eric" },
      description: "In a windswept chamber beneath the desert... determine the correct reordering of the sequence based on a given number of clockwise shifts.",
      starter: "",
      io: [],
      code: "def decode_artifact(arr, n):\n    return arr[n:] + arr[:n]", // Left shift instead of right shift
      testReport: [{ input: "[[17, 42, 8, 23, 5, 91, 34], 2]", expected: "[91, 34, 17, 42, 8, 23, 5]", actual: "[8, 23, 5, 91, 34, 17, 42]", equal: false }]
    }
  },

  // --- HAYSTACK 2: Jellybean Naming Crisis ---
  jellybean_naming_crisis: {
    pass: {
      meta: { title: "The Great Jellybean Naming Convention Crisis", name: "jelly_bean_duplicate_removal", category: "List-1: Indexing", question_type: ["haystack"], difficulty: "medium", author: "ChatGPT, edited by Emmanuelle" },
      description: "In the whimsical land of Sweetopolis... The King of Sweetopolis was baffled. 'How can I reward the inventors if the registry is cluttered with repeated flavor names?'",
      starter: "",
      io: [],
      code: "def jelly_bean_duplicate_removal(arr):\n    res = []\n    for flavor in arr:\n        if flavor not in res:\n            res.append(flavor)\n    return res",
      testReport: [{ input: '[["cherry", "cherry", "grape"]]', expected: '["cherry", "grape"]', actual: '["cherry", "grape"]', equal: true }]
    },
    fail: {
      meta: { title: "The Great Jellybean Naming Convention Crisis", name: "jelly_bean_duplicate_removal", category: "List-1: Indexing", question_type: ["haystack"], difficulty: "medium", author: "ChatGPT, edited by Emmanuelle" },
      description: "In the whimsical land of Sweetopolis... The King of Sweetopolis was baffled. 'How can I reward the inventors if the registry is cluttered with repeated flavor names?'",
      starter: "",
      io: [],
      code: "def jelly_bean_duplicate_removal(arr):\n    return arr", // Failed to remove duplicates
      testReport: [{ input: '[["cherry", "cherry", "grape"]]', expected: '["cherry", "grape"]', actual: '["cherry", "cherry", "grape"]', equal: false }]
    }
  }
};