// ===== QuestionLoader: Validation and Loading =====

/**
 * Validates a single question object.
 * Returns the object if valid, or null if invalid (with console.warn).
 */
function validateQuestion(obj) {
  var missing = [];

  if (!obj || typeof obj !== 'object') {
    console.warn('Invalid question: not an object');
    return null;
  }

  if (typeof obj.question !== 'string' || obj.question.trim() === '') {
    missing.push('question');
  }

  if (!obj.options || typeof obj.options !== 'object') {
    missing.push('options');
  } else {
    var optionKeys = Object.keys(obj.options).sort();
    if (optionKeys.length !== 3 || optionKeys[0] !== 'A' || optionKeys[1] !== 'B' || optionKeys[2] !== 'C') {
      missing.push('options (must have exactly keys A, B, C)');
    } else {
      if (typeof obj.options.A !== 'string' || obj.options.A.trim() === '') missing.push('options.A');
      if (typeof obj.options.B !== 'string' || obj.options.B.trim() === '') missing.push('options.B');
      if (typeof obj.options.C !== 'string' || obj.options.C.trim() === '') missing.push('options.C');
    }
  }

  if (obj.answer !== 'A' && obj.answer !== 'B' && obj.answer !== 'C') {
    missing.push('answer (must be A, B, or C)');
  }

  if (missing.length > 0) {
    console.warn('Skipping invalid question — missing/invalid fields: ' + missing.join(', '), obj);
    return null;
  }

  return obj;
}

/**
 * Fetches and parses questions from the given URL.
 * Returns an array of valid questions, or throws with a user-facing error message.
 */
async function loadQuestions(url) {
  var response;
  try {
    response = await fetch(url);
  } catch (e) {
    throw new Error("Oops! We couldn't load the questions. Please check your connection and try again!");
  }

  if (!response.ok) {
    throw new Error("Oops! We couldn't load the questions. Please check your connection and try again!");
  }

  var data;
  try {
    data = await response.json();
  } catch (e) {
    throw new Error("Oops! Something went wrong with the questions file. Please try again later!");
  }

  if (!Array.isArray(data)) {
    throw new Error("Oops! Something went wrong with the questions file. Please try again later!");
  }

  var valid = [];
  for (var i = 0; i < data.length; i++) {
    var q = validateQuestion(data[i]);
    if (q !== null) {
      valid.push(q);
    }
  }

  if (valid.length < 10) {
    throw new Error("Oops! We don't have enough questions right now. Please try again later!");
  }

  return valid;
}

// ===== QuestionTracker: Reuse Tracking =====

var QuestionTracker = (function () {
  var STORAGE_KEY = 'trivia_used_questions';
  var memoryFallback = null; // used when localStorage is unavailable

  function isLocalStorageAvailable() {
    try {
      var testKey = '__ls_test__';
      localStorage.setItem(testKey, '1');
      localStorage.removeItem(testKey);
      return true;
    } catch (e) {
      return false;
    }
  }

  function readStore() {
    if (!isLocalStorageAvailable()) {
      return memoryFallback || [];
    }
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw === null) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        // corrupted data — reset
        localStorage.removeItem(STORAGE_KEY);
        return [];
      }
      // Validate every element is an integer
      for (var i = 0; i < parsed.length; i++) {
        if (typeof parsed[i] !== 'number' || !Number.isInteger(parsed[i])) {
          localStorage.removeItem(STORAGE_KEY);
          return [];
        }
      }
      return parsed;
    } catch (e) {
      // corrupted JSON — reset
      try { localStorage.removeItem(STORAGE_KEY); } catch (ignore) {}
      return [];
    }
  }

  function writeStore(indices) {
    if (!isLocalStorageAvailable()) {
      memoryFallback = indices;
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(indices));
    } catch (e) {
      memoryFallback = indices;
    }
  }

  function getUsedIndices() {
    return readStore();
  }

  function markUsed(indices) {
    var current = readStore();
    var set = {};
    for (var i = 0; i < current.length; i++) {
      set[current[i]] = true;
    }
    for (var j = 0; j < indices.length; j++) {
      if (!set[indices[j]]) {
        current.push(indices[j]);
        set[indices[j]] = true;
      }
    }
    writeStore(current);
  }

  function getAvailableIndices(totalCount) {
    var used = readStore();

    // If bank size changed (any used index >= totalCount), reset
    for (var i = 0; i < used.length; i++) {
      if (used[i] >= totalCount || used[i] < 0) {
        reset();
        used = [];
        break;
      }
    }

    var usedSet = {};
    for (var j = 0; j < used.length; j++) {
      usedSet[used[j]] = true;
    }

    var available = [];
    for (var k = 0; k < totalCount; k++) {
      if (!usedSet[k]) {
        available.push(k);
      }
    }

    // Auto-reset if fewer than 10 available
    if (available.length < 10) {
      reset();
      available = [];
      for (var m = 0; m < totalCount; m++) {
        available.push(m);
      }
    }

    return available;
  }

  function reset() {
    if (isLocalStorageAvailable()) {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) {}
    }
    memoryFallback = null;
  }

  return {
    getUsedIndices: getUsedIndices,
    markUsed: markUsed,
    getAvailableIndices: getAvailableIndices,
    reset: reset
  };
})();

// ===== GameEngine: Core State Management =====

var GameEngine = (function () {
  var questionBank = [];
  var sessionQuestions = [];
  var sessionIndices = [];
  var currentIndex = 0;
  var score = 0;
  var correctCount = 0;
  var lastPoints = 0;
  var isAnswered = false;
  var selectedOption = null;
  var timeRemaining = 15;
  var phase = 'loading';

  async function init(url) {
    phase = 'loading';
    questionBank = await loadQuestions(url);
  }

  function startSession(category) {
    var totalCount = questionBank.length;
    var available = QuestionTracker.getAvailableIndices(totalCount);

    // Filter by category if specified
    if (category && category !== 'All') {
      available = available.filter(function (idx) {
        return questionBank[idx].category === category;
      });
      // If fewer than 10 in this category available, reset tracker and try again
      if (available.length < 10) {
        QuestionTracker.reset();
        available = [];
        for (var m = 0; m < totalCount; m++) {
          if (questionBank[m].category === category) {
            available.push(m);
          }
        }
      }
    }

    // Pick 10 random indices from available pool
    var shuffled = available.slice();
    for (var i = shuffled.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var temp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = temp;
    }

    sessionIndices = shuffled.slice(0, 10);

    // Build session questions from selected indices
    sessionQuestions = [];
    for (var k = 0; k < sessionIndices.length; k++) {
      sessionQuestions.push(questionBank[sessionIndices[k]]);
    }

    // Reset all state
    currentIndex = 0;
    score = 0;
    correctCount = 0;
    lastPoints = 0;
    isAnswered = false;
    selectedOption = null;
    timeRemaining = 15;
    phase = 'playing';
  }

  function selectAnswer(option) {
    // Guard: no-op if already answered or not in playing phase
    if (isAnswered || phase !== 'playing') {
      return;
    }

    isAnswered = true;
    selectedOption = option;

    // Compare to correct answer and update score
    // Points scale with time remaining: 100 at 15s, down to 10 at 1s
    if (option === sessionQuestions[currentIndex].answer) {
      var points = Math.max(10, Math.round((timeRemaining / 15) * 100));
      score += points;
      correctCount += 1;
      lastPoints = points;
    } else {
      lastPoints = 0;
    }

    phase = 'feedback';
  }

  function nextQuestion() {
    currentIndex += 1;

    if (currentIndex >= 10) {
      phase = 'results';
      QuestionTracker.markUsed(sessionIndices);
      return;
    }

    isAnswered = false;
    selectedOption = null;
    timeRemaining = 15;
    phase = 'playing';
  }

  function getState() {
    return {
      questions: sessionQuestions.slice(),
      currentIndex: currentIndex,
      score: score,
      correctCount: correctCount,
      lastPoints: lastPoints,
      isAnswered: isAnswered,
      selectedOption: selectedOption,
      timeRemaining: timeRemaining,
      phase: phase
    };
  }

  return {
    init: init,
    startSession: startSession,
    selectAnswer: selectAnswer,
    nextQuestion: nextQuestion,
    getState: getState,
    // Expose internals needed by other components
    getQuestionBank: function () { return questionBank; },
    getSessionIndices: function () { return sessionIndices; },
    setScore: function (s) { score = s; },
    setCurrentIndex: function (idx) { currentIndex = idx; },
    setIsAnswered: function (val) { isAnswered = val; },
    setSelectedOption: function (val) { selectedOption = val; },
    setTimeRemaining: function (val) { timeRemaining = val; },
    setPhase: function (val) { phase = val; }
  };
})();

// ===== TimerManager: Per-Question Countdown =====

var TimerManager = (function () {
  var intervalId = null;
  var remaining = 0;

  function start(seconds, onTick, onExpire) {
    // Stop any existing timer first
    stop();

    remaining = seconds;

    // Call onTick immediately to show initial value
    onTick(remaining);

    intervalId = setInterval(function () {
      remaining -= 1;

      if (remaining <= 0) {
        remaining = 0;
        clearInterval(intervalId);
        intervalId = null;
        onExpire();
      } else {
        onTick(remaining);
      }
    }, 1000);
  }

  function stop() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  function getRemaining() {
    return remaining;
  }

  return {
    start: start,
    stop: stop,
    getRemaining: getRemaining
  };
})();

// ===== UIRenderer: DOM Manipulation =====

var UIRenderer = (function () {
  function getEl(id) {
    return document.getElementById(id);
  }

  var optionMap = { A: 'option-a', B: 'option-b', C: 'option-c' };

  function renderQuestion(question, index, total) {
    // Clean up any lingering animations before rendering new question
    AnimationManager.cleanup();

    // Show game screen, hide others
    getEl('splash-screen').classList.add('hidden');
    getEl('loading-screen').classList.add('hidden');
    getEl('error-screen').classList.add('hidden');
    getEl('results-screen').classList.add('hidden');
    getEl('game-screen').classList.remove('hidden');
    getEl('game-header').classList.remove('hidden');

    // Question text
    getEl('question-text').textContent = question.question;

    // Progress
    getEl('progress-display').textContent = 'Question ' + (index + 1) + ' of ' + total;

    // Option buttons
    var labels = ['A', 'B', 'C'];
    for (var i = 0; i < labels.length; i++) {
      var key = labels[i];
      var btn = getEl(optionMap[key]);
      btn.querySelector('.option-text').textContent = question.options[key];
      btn.disabled = false;
      btn.classList.remove('correct', 'incorrect');
    }

    // Hide next button and show points display
    getEl('next-btn').classList.remove('show');
    getEl('points-possible').style.visibility = 'visible';
    getEl('points-possible').classList.remove('low-points', 'very-low-points', 'dropping');
  }

  function renderFeedback(selected, correct) {
    var correctBtn = getEl(optionMap[correct]);
    correctBtn.classList.add('correct');

    if (selected === null) {
      // Timeout case: just highlight correct in green, no incorrect highlight
      return;
    }

    if (selected === correct) {
      AnimationManager.playCelebration(correctBtn);
    } else {
      var selectedBtn = getEl(optionMap[selected]);
      selectedBtn.classList.add('incorrect');
    }
  }

  function renderScore(score) {
    getEl('score-display').textContent = '💰 Score: ' + score;
  }

  function renderTimer(seconds) {
    var timerEl = getEl('timer-display');
    var timerBox = getEl('timer-box');
    timerEl.textContent = seconds;

    if (seconds <= 5) {
      timerEl.classList.add('timer-warning');
      timerBox.classList.add('timer-warning-box');
    } else {
      timerEl.classList.remove('timer-warning');
      timerBox.classList.remove('timer-warning-box');
    }

    // Update points possible display
    var pointsEl = getEl('points-possible');
    var points = Math.max(10, Math.round((seconds / 15) * 100));
    pointsEl.textContent = points;

    // Color coding based on points value
    pointsEl.classList.remove('low-points', 'very-low-points');
    if (points <= 20) {
      pointsEl.classList.add('very-low-points');
    } else if (points <= 50) {
      pointsEl.classList.add('low-points');
    }

    // Trigger drop animation on each tick
    pointsEl.classList.remove('dropping');
    void pointsEl.offsetWidth;
    pointsEl.classList.add('dropping');
  }

  function renderResults(score, total, correctCount) {
    getEl('game-screen').classList.add('hidden');
    getEl('results-screen').classList.remove('hidden');

    var wrongCount = 10 - correctCount;
    getEl('results-correct').textContent = correctCount;
    getEl('results-wrong').textContent = wrongCount;
    getEl('results-points').textContent = score;

    var message;
    if (correctCount === 10) {
      message = "PERFECT! You're a trivia superstar! 🌟";
    } else if (correctCount >= 8) {
      message = "Amazing job! You're so smart! 🎉";
    } else if (correctCount >= 5) {
      message = "Great effort! Keep playing to learn more! 💪";
    } else if (correctCount >= 1) {
      message = "Good try! You'll do even better next time! 😊";
    } else {
      message = "Don't worry! Every game helps you learn! 🌈";
    }

    getEl('results-message').textContent = message;
  }

  function renderError(message) {
    getEl('loading-screen').classList.add('hidden');
    getEl('game-screen').classList.add('hidden');
    getEl('results-screen').classList.add('hidden');
    getEl('error-screen').classList.remove('hidden');
    getEl('error-message').textContent = message;
  }

  function showNextButton() {
    getEl('next-btn').classList.add('show');
  }

  function disableOptions() {
    var labels = ['A', 'B', 'C'];
    for (var i = 0; i < labels.length; i++) {
      getEl(optionMap[labels[i]]).disabled = true;
    }
    // Hide points possible when question is resolved
    getEl('points-possible').style.visibility = 'hidden';
  }

  function transitionToQuestion(question, index, total) {
    AnimationManager.cleanup();
    var container = getEl('question-container');
    AnimationManager.playQuestionTransition(container, container, function () {
      renderQuestion(question, index, total);
    });
  }

  return {
    renderQuestion: renderQuestion,
    renderFeedback: renderFeedback,
    renderScore: renderScore,
    renderTimer: renderTimer,
    renderResults: renderResults,
    renderError: renderError,
    showNextButton: showNextButton,
    disableOptions: disableOptions,
    transitionToQuestion: transitionToQuestion
  };
})();

// ===== EventHandlers: User Interaction Wiring =====

var EventHandlers = (function () {
  function bindOptionClick(callback) {
    var buttons = document.querySelectorAll('.option-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].addEventListener('click', function () {
        var option = this.getAttribute('data-option');
        callback(option);
      });
    }
  }

  function bindNextClick(callback) {
    var btn = document.getElementById('next-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        callback();
      });
    }
  }

  function bindPlayAgainClick(callback) {
    var btn = document.getElementById('play-again-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        callback();
      });
    }
  }

  return {
    bindOptionClick: bindOptionClick,
    bindNextClick: bindNextClick,
    bindPlayAgainClick: bindPlayAgainClick
  };
})();

// ===== AnimationManager: Transitions and Celebrations =====

var AnimationManager = (function () {
  var CONFETTI_COLORS = ['var(--purple)', 'var(--teal)', 'var(--orange)', 'var(--pink)', 'var(--green)'];

  function playQuestionTransition(outEl, inEl, onMidpoint) {
    outEl.classList.add('slide-fade-out');

    function onOutEnd() {
      outEl.removeEventListener('animationend', onOutEnd);
      outEl.classList.remove('slide-fade-out');

      // Swap content at midpoint
      onMidpoint();

      // inEl is the container that now has new content — slide it in
      inEl.classList.add('slide-fade-in');

      function onInEnd() {
        inEl.removeEventListener('animationend', onInEnd);
        inEl.classList.remove('slide-fade-in');
      }
      inEl.addEventListener('animationend', onInEnd);
    }

    outEl.addEventListener('animationend', onOutEnd);
  }

  function playCelebration(targetEl) {
    var gameContainer = document.getElementById('game-container');
    if (!gameContainer) return;

    // Create confetti container
    var container = document.createElement('div');
    container.className = 'confetti-container';

    // Calculate position relative to targetEl within game-container
    var containerRect = gameContainer.getBoundingClientRect();
    var targetRect = targetEl.getBoundingClientRect();
    var centerTop = targetRect.top - containerRect.top + targetRect.height / 2;
    var centerLeft = targetRect.left - containerRect.left + targetRect.width / 2;

    // Spawn 25 confetti particles
    var particleCount = 25;
    for (var i = 0; i < particleCount; i++) {
      var particle = document.createElement('span');
      particle.className = 'confetti-particle';

      // Randomize CSS custom properties
      var xVal = (Math.random() * 160 - 80); // -80px to 80px
      var rotVal = (Math.random() * 540 + 180); // 180deg to 720deg
      var color = CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)];

      particle.style.setProperty('--x', xVal + 'px');
      particle.style.setProperty('--rotation', rotVal + 'deg');
      particle.style.setProperty('--color', color);
      particle.style.top = centerTop + 'px';
      particle.style.left = centerLeft + 'px';

      container.appendChild(particle);
    }

    gameContainer.appendChild(container);

    // Apply bounce-pop to the target button
    targetEl.classList.add('bounce-pop');

    // Remove confetti container and bounce-pop after animations complete (~800ms)
    setTimeout(function () {
      if (container.parentNode) {
        container.parentNode.removeChild(container);
      }
      targetEl.classList.remove('bounce-pop');
    }, 800);
  }

  function cleanup() {
    // Remove all confetti containers
    var containers = document.querySelectorAll('.confetti-container');
    for (var i = 0; i < containers.length; i++) {
      if (containers[i].parentNode) {
        containers[i].parentNode.removeChild(containers[i]);
      }
    }

    // Remove animation classes from any elements that still have them
    var animClasses = ['slide-fade-out', 'slide-fade-in', 'bounce-pop'];
    for (var c = 0; c < animClasses.length; c++) {
      var els = document.querySelectorAll('.' + animClasses[c]);
      for (var j = 0; j < els.length; j++) {
        els[j].classList.remove(animClasses[c]);
      }
    }
  }

  return {
    playQuestionTransition: playQuestionTransition,
    playCelebration: playCelebration,
    cleanup: cleanup
  };
})();

// ===== Game Wiring: Initialization and Game Loop =====

if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', function () {

    // Suppress right-click context menu
    document.addEventListener('contextmenu', function (e) {
      e.preventDefault();
    });

    // Settings menu toggle
    var settingsBtn = document.getElementById('settings-btn');
    var settingsMenu = document.getElementById('settings-menu');
    settingsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      settingsMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', function () {
      settingsMenu.classList.add('hidden');
    });

    // Reset questions button
    document.getElementById('reset-questions-btn').addEventListener('click', function () {
      QuestionTracker.reset();
      settingsMenu.classList.add('hidden');
      alert('Questions have been reset! All questions are available again.');
    });

    // Timer countdown sound
    var timerSound = new Audio('626908__muzakplz__marktimer.wav');
    timerSound.loop = true;

    // Answer feedback sounds
    var correctSound = new Audio('538147__fupicat__correct-bell.wav');
    var wrongSound = new Audio('648462__andreas__wrong-answer.mp3');
    var gameOverSound = new Audio('Apr 25 at 1-13 PM.m4a');

    function playTimerSound() {
      timerSound.currentTime = 0;
      timerSound.play().catch(function () {
        // Browser may block autoplay until user interaction — that's ok
      });
    }

    function stopTimerSound() {
      timerSound.pause();
      timerSound.currentTime = 0;
    }

    var selectedCategory = 'All';
    var gameStarted = false;

    function startNewGame() {
      GameEngine.startSession(selectedCategory);
      showCurrentQuestion();
      startTimer();
    }

    function showCurrentQuestion() {
      var state = GameEngine.getState();
      UIRenderer.renderQuestion(state.questions[state.currentIndex], state.currentIndex, 10);
      UIRenderer.renderScore(state.score);
    }

    function startTimer() {
      playTimerSound();
      TimerManager.start(15, function onTick(seconds) {
        UIRenderer.renderTimer(seconds);
        GameEngine.setTimeRemaining(seconds);
      }, function onExpire() {
        handleTimeout();
      });
    }

    function handleTimeout() {
      stopTimerSound();
      wrongSound.currentTime = 0;
      wrongSound.play().catch(function () {});
      GameEngine.setIsAnswered(true);
      GameEngine.setPhase('feedback');
      var state = GameEngine.getState();
      var correctAnswer = state.questions[state.currentIndex].answer;
      UIRenderer.disableOptions();
      UIRenderer.renderFeedback(null, correctAnswer);
      setTimeout(function () {
        UIRenderer.showNextButton();
      }, 1500);
    }

    function handleAnswerClick(option) {
      stopTimerSound();
      TimerManager.stop();
      GameEngine.selectAnswer(option);
      var state = GameEngine.getState();
      var correct = state.questions[state.currentIndex].answer;
      UIRenderer.disableOptions();
      UIRenderer.renderFeedback(option, correct);
      UIRenderer.renderScore(state.score);

      // Play correct or wrong sound
      if (option === correct) {
        correctSound.currentTime = 0;
        correctSound.play().catch(function () {});
      } else {
        wrongSound.currentTime = 0;
        wrongSound.play().catch(function () {});
      }

      setTimeout(function () {
        UIRenderer.showNextButton();
      }, 1500);
    }

    function handleNextClick() {
      GameEngine.nextQuestion();
      var state = GameEngine.getState();
      if (state.phase === 'results') {
        UIRenderer.renderResults(state.score, 1000, state.correctCount);
        document.getElementById('settings-wrapper').classList.remove('hidden');
        gameOverSound.currentTime = 0;
        gameOverSound.play().catch(function () {});
      } else {
        UIRenderer.transitionToQuestion(state.questions[state.currentIndex], state.currentIndex, 10);
        UIRenderer.renderScore(state.score);
        startTimer();
      }
    }

    function handlePlayAgain() {
      // Show splash screen for category selection instead of starting directly
      document.getElementById('results-screen').classList.add('hidden');
      document.getElementById('game-screen').classList.add('hidden');
      document.getElementById('game-header').classList.add('hidden');
      document.getElementById('splash-screen').classList.remove('hidden');
      document.getElementById('settings-wrapper').classList.remove('hidden');
      gameStarted = false;
      introSound.currentTime = 0;
      introSound.play().catch(function () {});
    }

    // Intro sound (declared here so launchGame is accessible from keyboard handler)
    var introSound = new Audio('Apr 25 at 12-39 PM.m4a');

    function launchGame() {
      if (gameStarted) return;
      gameStarted = true;
      document.getElementById('settings-wrapper').classList.add('hidden');
      document.getElementById('splash-screen').classList.add('hidden');
      startNewGame();
    }

    // Bind event handlers
    EventHandlers.bindOptionClick(handleAnswerClick);
    EventHandlers.bindNextClick(handleNextClick);
    EventHandlers.bindPlayAgainClick(handlePlayAgain);

    // Keyboard support: A/B/C to answer, Space for Next/Play Again, Space/Enter for splash
    document.addEventListener('keydown', function (e) {
      var key = e.key.toUpperCase();
      var state = GameEngine.getState();

      // Answer with A/B/C during gameplay
      if ((key === 'A' || key === 'B' || key === 'C') && state.phase === 'playing' && !state.isAnswered) {
        handleAnswerClick(key);
      // Space to advance to next question
      } else if (e.key === ' ' && document.getElementById('next-btn').classList.contains('show')) {
        e.preventDefault();
        handleNextClick();
      // Space on results screen to go back to category selection
      } else if (e.key === ' ' && !document.getElementById('results-screen').classList.contains('hidden')) {
        e.preventDefault();
        handlePlayAgain();
      // Space or Enter on splash screen to start game
      } else if ((e.key === ' ' || e.key === 'Enter') && !gameStarted && !document.getElementById('splash-screen').classList.contains('hidden')) {
        e.preventDefault();
        launchGame();
      }
    });

    // Pre-load questions, then show splash screen
    GameEngine.init('questions.json').then(function () {
      // Play intro sound when splash screen loads
      introSound.currentTime = 0;
      introSound.play().catch(function () {});

      var startBtn = document.getElementById('start-btn');

      // Category selection on splash screen
      var categoryBtns = document.querySelectorAll('.category-btn');
      for (var i = 0; i < categoryBtns.length; i++) {
        categoryBtns[i].addEventListener('click', function () {
          for (var j = 0; j < categoryBtns.length; j++) {
            categoryBtns[j].classList.remove('selected');
          }
          this.classList.add('selected');
          selectedCategory = this.getAttribute('data-category');
        });
      }

      if (startBtn) {
        startBtn.addEventListener('click', launchGame);
      }
    }).catch(function (error) {
      document.getElementById('splash-screen').classList.add('hidden');
      UIRenderer.renderError(error.message);
    });
  });
}

// ===== Module exports for testing =====
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateQuestion, loadQuestions, QuestionTracker, GameEngine, TimerManager, UIRenderer, EventHandlers, AnimationManager };
}
