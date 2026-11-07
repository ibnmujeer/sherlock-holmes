(function () {
  'use strict';

  const book = window.AWWFY_BOOK;
  const characters = window.AWWFY_CHARACTERS || [];
  const app = document.getElementById('app');
  if (!book || !app) return;

  const storageKey = `awwfy-${book.slug}-progress`;
  const stepNames = [
    ['story', 'Story'], ['words', 'Words'], ['order', 'Order'], ['quiz', 'Quiz'], ['sayIt', 'Say it']
  ];
  const state = {
    screen: 'start', chapterId: null, chapter: null, step: 'story', page: 0,
    original: null, originalPanel: false, loading: false, error: false,
    orderShuffled: [], orderPicked: [], orderFeedback: '', quizIndex: 0,
    quizRight: false, quizWrong: -1, completed: false, reading: false,
    speechLines: [], speechIndex: 0, starringIndex: 0, darkMode: false, progress: readProgress()
  };

  function readProgress() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(storageKey) || '{}');
      const validIds = new Set(book.chapters.map((chapter) => chapter.id));
      return {
        read: Array.isArray(saved.read) ? saved.read.filter((id) => validIds.has(id)) : [],
        last: typeof saved.last === 'string' && validIds.has(saved.last) ? saved.last : ''
      };
    } catch (error) {
      return { read: [], last: '' };
    }
  }

  function saveProgress() {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify({ read: state.progress.read, last: state.progress.last }));
    } catch (error) {
      // Reading stays available when local storage is blocked.
    }
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeButton(label, action, className, disabled) {
    const node = el('button', className || '', label);
    node.type = 'button';
    node.disabled = Boolean(disabled);
    if (action) node.addEventListener('click', action);
    return node;
  }

  function append(parent, ...children) {
    children.forEach((child) => child && parent.appendChild(child));
    return parent;
  }

  function stopSpeech() {
    if (window.speechSynthesis) window.speechSynthesis.cancel();
    state.reading = false;
    state.speechLines = [];
    state.speechIndex = 0;
    clearSpeakingMarks();
  }

  function clearSpeakingMarks() {
    document.querySelectorAll('.story-sentence.is-speaking').forEach((node) => node.classList.remove('is-speaking'));
  }

  function voiceReady() {
    return Boolean(window.speechSynthesis && window.SpeechSynthesisUtterance && window.speechSynthesis.getVoices().length);
  }

  function speakLines(lines, button, sentenceMode) {
    if (!voiceReady()) return;
    stopSpeech();
    state.reading = true;
    state.speechLines = lines.slice();
    state.speechIndex = 0;
    if (button) button.textContent = 'Stop';
    speakNext(button, sentenceMode);
  }

  function speakNext(button, sentenceMode) {
    if (!state.reading || state.speechIndex >= state.speechLines.length) {
      state.reading = false;
      state.speechLines = [];
      state.speechIndex = 0;
      clearSpeakingMarks();
      if (button && button.isConnected) button.textContent = sentenceMode ? 'Read to me' : 'Hear it';
      return;
    }
    clearSpeakingMarks();
    if (sentenceMode) {
      const mark = document.querySelector(`[data-sentence-index="${state.speechIndex}"]`);
      if (mark) mark.classList.add('is-speaking');
    }
    const utterance = new window.SpeechSynthesisUtterance(state.speechLines[state.speechIndex]);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    utterance.onend = function () {
      if (!state.reading) return;
      state.speechIndex += 1;
      speakNext(button, sentenceMode);
    };
    utterance.onerror = function () {
      state.reading = false;
      clearSpeakingMarks();
      if (button && button.isConnected) button.textContent = sentenceMode ? 'Read to me' : 'Hear it';
    };
    window.speechSynthesis.speak(utterance);
  }

  function attachPicture(frame, src, alt, fallbackClass) {
    const image = document.createElement('img');
    image.src = src;
    image.alt = alt;
    image.addEventListener('error', function () {
      const fallback = el('div', fallbackClass || 'picture-fallback', alt);
      fallback.setAttribute('role', 'img');
      fallback.setAttribute('aria-label', alt);
      image.replaceWith(fallback);
    }, { once: true });
    frame.appendChild(image);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Could not load ${src}`));
      document.head.appendChild(script);
    });
  }

  function chapterFor(id) {
    return book.chapters.find((chapter) => chapter.id === id);
  }

  function openChapter(id) {
    const entry = chapterFor(id);
    if (!entry || !entry.ready) return;
    stopSpeech();
    state.screen = 'chapter';
    state.chapterId = id;
    state.chapter = null;
    state.original = null;
    state.originalPanel = false;
    state.loading = true;
    state.error = false;
    state.step = 'story';
    state.page = 0;
    state.orderPicked = [];
    state.orderFeedback = '';
    state.quizIndex = 0;
    state.quizRight = false;
    state.quizWrong = -1;
    state.completed = false;
    state.progress.last = id;
    saveProgress();
    renderLoading();

    const chapterSrc = `js/chapters/ch${id}.js`;
    const originalSrc = `js/originals/ch${id}.js`;
    Promise.all([
      loadScript(chapterSrc),
      loadScript(originalSrc).catch(() => null)
    ]).then(() => {
      const chapterData = window.AWWFY_CHAPTERS && window.AWWFY_CHAPTERS[id];
      if (!chapterData) throw new Error('Chapter data is missing.');
      state.chapter = chapterData;
      state.original = window.AWWFY_ORIGINALS && window.AWWFY_ORIGINALS[id] ? window.AWWFY_ORIGINALS[id] : null;
      state.loading = false;
    prepareOrder();
      renderChapter();
    }).catch(() => {
      state.loading = false;
      state.error = true;
      renderLoadError();
    });
  }

  function prepareOrder() {
    state.orderShuffled = state.chapter.order.map((_, index) => index);
    for (let i = state.orderShuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.orderShuffled[i], state.orderShuffled[j]] = [state.orderShuffled[j], state.orderShuffled[i]];
    }
    if (state.orderShuffled.every((value, index) => value === index)) {
      state.orderShuffled.push(state.orderShuffled.shift());
    }
    state.orderPicked = [];
    state.orderFeedback = '';
  }

  function shell(content) {
    app.replaceChildren(content);
    return content;
  }

  function renderLoading() {
    const panel = el('main', 'load-message');
    panel.setAttribute('role', 'status');
    panel.textContent = 'Loading...';
    shell(panel);
  }

  function renderLoadError() {
    const panel = el('main', 'load-message');
    append(panel,
      el('p', '', 'This chapter could not open. Please go back and try again.'),
      makeButton('Back', () => showMenu(), 'primary-button')
    );
    shell(panel);
  }

  function renderStart() {
    stopSpeech();
    state.screen = 'start';
    const main = el('main', 'screen start-card');
    const copy = el('div', 'start-copy');
    const continueChapter = chapterFor(state.progress.last);
    const startLabel = continueChapter && continueChapter.ready
      ? `Continue: Chapter ${continueChapter.id}`
      : 'Start reading';
    const credit = `Retold from ${book.title} by ${book.author} (${book.year}).`;
    const cover = el('div', 'cover-frame');
    attachPicture(cover, book.cover.image, book.cover.alt, 'cover-fallback');
    const title = el('h1', '', book.title);
    const creditText = el('p', 'credit', credit);
    const start = makeButton(startLabel, () => {
      if (continueChapter && continueChapter.ready) openChapter(continueChapter.id);
      else showMenu();
    }, 'primary-button');
    const link = el('a', 'studio-link', 'Awwfy Studios');
    link.href = 'https://awwfy.com';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    append(copy, title, creditText, start, link);
    append(main, copy, cover);
    shell(main);
  }

  function showMenu() {
    stopSpeech();
    state.screen = 'menu';
    state.originalPanel = false;
    renderMenu();
  }

  function renderMenu() {
    const main = el('main', 'screen menu-card');
    main.style.padding = 'clamp(1rem, 4vw, 2rem)';
    const header = el('div', 'screen-header');
    const title = el('h1', '', 'Choose a chapter');
    const back = makeButton('Start screen', renderStart, 'small-button');
    const progressText = `${state.progress.read.length} of ${book.chapters.length} chapters read`;
    append(header, title, back, el('p', 'progress-line', progressText));
    const list = el('ul', 'menu-list');
    const starringRow = el('li', 'menu-row starring-row');
    const starringNumber = el('span', 'chapter-number', String(characters.length));
    const starringTitle = el('p', 'chapter-title', 'Starring');
    const starringButton = makeButton('View', showStarring, 'chapter-status');
    append(starringRow, starringNumber, starringTitle, starringButton);
    list.appendChild(starringRow);
    book.chapters.forEach((chapter) => {
      const row = el('li', 'menu-row');
      const number = el('span', 'chapter-number', chapter.id);
      const chapterTitle = el('p', 'chapter-title', chapter.title);
      const isRead = state.progress.read.includes(chapter.id);
      const status = isRead ? 'Read' : (chapter.ready ? 'Start' : 'Coming soon');
      const statusClass = isRead ? 'status-read' : (!chapter.ready ? 'status-soon' : '');
      const statusButton = makeButton(status, chapter.ready ? () => openChapter(chapter.id) : null,
        `chapter-status ${statusClass}`, !chapter.ready);
      append(row, number, chapterTitle, statusButton);
      list.appendChild(row);
    });
    append(main, header, list);
    shell(main);
  }

  function showStarring() {
    stopSpeech();
    state.screen = 'starring';
    state.starringIndex = 0;
    renderStarring();
  }

  function renderStarring() {
    const main = el('main', 'screen chapter-card starring-card');
    const header = el('div', 'chapter-topline');
    const title = el('h1', '', 'Starring');
    append(header, title, makeButton('Menu', showMenu, 'small-button'));
    const body = el('section', 'starring-page');
    body.setAttribute('aria-label', `Starring page ${state.starringIndex + 1}`);
    const person = characters[state.starringIndex];
    if (person) {
      const frame = el('div', 'starring-picture');
      attachPicture(frame, person.image, person.alt, 'picture-fallback');
      const name = el('h2', 'starring-name', person.name);
      const controls = el('div', 'starring-controls');
      const previous = makeButton('Previous', () => moveStarring(-1), 'small-button', state.starringIndex === 0);
      const next = makeButton('Next', () => moveStarring(1), 'primary-button', state.starringIndex === characters.length - 1);
      const count = el('p', 'page-count', `Page ${state.starringIndex + 1} of ${characters.length}`);
      append(controls, previous, next);
      append(body, frame, name, controls, count);
    } else {
      append(body, el('p', 'quiet-note', 'Character pictures are not available.'));
    }
    append(main, header, body);
    shell(main);
  }

  function moveStarring(delta) {
    const nextIndex = state.starringIndex + delta;
    if (nextIndex < 0 || nextIndex >= characters.length) return;
    state.starringIndex = nextIndex;
    renderStarring();
  }

  function renderChapter() {
    if (!state.chapter) return renderLoadError();
    const main = el('main', 'screen chapter-card');
    const header = el('div', 'chapter-topline');
    const title = el('h1', '', state.chapter.title);
    const menu = makeButton('Menu', showMenu, 'small-button');
    const themeButton = makeButton(state.darkMode ? 'Light mode' : 'Dark mode', () => {
      state.darkMode = !state.darkMode;
      app.classList.toggle('is-dark', state.darkMode);
      renderChapter();
    }, 'small-button');
    themeButton.setAttribute('aria-pressed', String(state.darkMode));
    append(header, title, themeButton, menu);
    const tabs = el('nav', 'step-tabs');
    tabs.setAttribute('aria-label', 'Chapter steps');
    stepNames.forEach(([key, label]) => {
      const tab = makeButton(label, () => changeStep(key), 'step-pill');
      tab.setAttribute('aria-current', state.step === key ? 'step' : 'false');
      tabs.appendChild(tab);
    });
    const body = el('section', 'step-body');
    body.setAttribute('aria-label', `${state.chapter.title}, ${stepNames.find((step) => step[0] === state.step)[1]}`);
    if (state.step === 'story') renderStory(body);
    if (state.step === 'words') renderWords(body);
    if (state.step === 'order') renderOrder(body);
    if (state.step === 'quiz') renderQuiz(body);
    if (state.step === 'sayIt') renderSayIt(body);
    append(main, header, tabs, body);
    if (state.originalPanel && state.original) main.appendChild(renderOriginalPanel());
    shell(main);
  }

  function changeStep(key) {
    stopSpeech();
    state.step = key;
    if (key === 'order' && !state.orderShuffled.length) prepareOrder();
    renderChapter();
  }

  function renderStory(parent) {
    const page = state.chapter.pages[state.page];
    const hook = el('p', 'hook', state.chapter.hook);
    const storyPage = el('div', 'story-page');
    storyPage.setAttribute('aria-label', `Story page ${state.page + 1}`);
    const frame = el('div', 'picture-frame');
    attachPicture(frame, page.image, page.alt, 'picture-fallback');
    const copy = el('div', 'story-copy');
    copy.setAttribute('aria-label', 'Story text');
    page.text.forEach((sentence, index) => {
      const line = el('span', 'story-sentence', sentence);
      line.dataset.sentenceIndex = String(index);
      copy.appendChild(line);
    });
    append(storyPage, frame, copy);
    storyPage.addEventListener('touchstart', (event) => {
      state.touchStartX = event.changedTouches[0].clientX;
    }, { passive: true });
    storyPage.addEventListener('touchend', (event) => {
      const dx = event.changedTouches[0].clientX - (state.touchStartX || 0);
      if (Math.abs(dx) > 55) movePage(dx < 0 ? 1 : -1);
    }, { passive: true });

    const controls = el('div', 'story-controls');
    if (voiceReady()) {
      const readButton = makeButton('Read to me', function () {
        if (state.reading) {
          stopSpeech();
          renderChapter();
        } else {
          speakLines(page.text, readButton, true);
        }
      }, 'small-button read-aloud-btn');
      controls.appendChild(readButton);
    }
    if (state.original) {
      controls.appendChild(makeButton('Read the real book', () => {
        state.originalPanel = true;
        renderChapter();
      }, 'small-button'));
    }

    const pageControls = el('div', 'page-controls');
    const back = makeButton('Back', () => movePage(-1), 'small-button', state.page === 0);
    const dots = el('div', 'page-dots');
    state.chapter.pages.forEach((_, index) => {
      const dot = makeButton(String(index + 1), () => { state.page = index; stopSpeech(); renderChapter(); }, 'page-dot');
      dot.setAttribute('aria-label', `Go to page ${index + 1}`);
      dot.setAttribute('aria-current', state.page === index ? 'page' : 'false');
      dots.appendChild(dot);
    });
    const next = makeButton('Next', () => movePage(1), 'small-button', state.page === state.chapter.pages.length - 1);
    append(pageControls, back, dots, next);
    const count = el('p', 'page-count', `Page ${state.page + 1} of ${state.chapter.pages.length}`);
    append(parent, hook, storyPage, controls, pageControls, count);
  }

  function movePage(delta) {
    const next = state.page + delta;
    if (next < 0 || next >= state.chapter.pages.length) return;
    stopSpeech();
    state.page = next;
    renderChapter();
  }

  function renderWords(parent) {
    const heading = el('h2', '', 'Word cards');
    const grid = el('div', 'word-grid');
    state.chapter.words.forEach((entry, index) => {
      let flipped = false;
      const card = el('article', 'word-card');
      const face = el('button', 'word-face');
      face.type = 'button';
      face.setAttribute('aria-expanded', 'false');
      const showFront = () => {
        face.replaceChildren(el('span', 'word-front', entry.word));
        face.setAttribute('aria-label', `${entry.word}. Tap to see meaning and example.`);
        face.setAttribute('aria-expanded', 'false');
      };
      const showBack = () => {
        const back = el('span', 'word-back');
        append(back, el('p', '', entry.meaning), el('p', '', `Example: ${entry.example}`));
        face.replaceChildren(back);
        face.setAttribute('aria-label', `${entry.word}. ${entry.meaning} Example: ${entry.example}`);
        face.setAttribute('aria-expanded', 'true');
      };
      showFront();
      face.addEventListener('click', () => {
        flipped = !flipped;
        if (flipped) showBack(); else showFront();
      });
      const speaker = makeButton(`Hear ${entry.word}`, () => {
        if (voiceReady()) {
          const utterance = new window.SpeechSynthesisUtterance(entry.word);
          utterance.lang = 'en-US';
          utterance.rate = 0.9;
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      }, 'small-button');
      speaker.setAttribute('aria-label', `Read the word ${entry.word} aloud`);
      if (!voiceReady()) speaker.hidden = true;
      append(card, face, speaker);
      card.dataset.cardIndex = String(index);
      grid.appendChild(card);
    });
    append(parent, heading, grid);
  }

  function renderOrder(parent) {
    const heading = el('h2', '', 'Put the events in order');
    const instructions = el('p', 'order-instructions', 'Tap each event in the order you think it happened. Tap a chosen event to move it back.');
    const layout = el('div', 'order-layout');
    const remaining = el('section', 'order-column');
    remaining.appendChild(el('h3', '', 'Events to choose'));
    const remainingList = el('div', 'event-list');
    state.orderShuffled.filter((index) => !state.orderPicked.includes(index)).forEach((index) => {
      remainingList.appendChild(makeButton(state.chapter.order[index], () => {
        state.orderPicked.push(index);
        state.orderFeedback = '';
        renderChapter();
      }, ''));
    });
    const picked = el('section', 'order-column');
    picked.appendChild(el('h3', '', 'Your order'));
    const pickedList = el('ol', 'event-list');
    state.orderPicked.forEach((index, place) => {
      const item = el('li', 'picked-event');
      append(item,
        el('span', 'event-index', String(place + 1)),
        makeButton(state.chapter.order[index], () => {
          state.orderPicked.splice(place, 1);
          state.orderFeedback = '';
          renderChapter();
        }, '')
      );
      pickedList.appendChild(item);
    });
    append(remaining, remainingList);
    append(picked, pickedList);
    append(layout, remaining, picked);
    const check = makeButton('Check order', () => checkOrder(), 'primary-button', state.orderPicked.length !== state.chapter.order.length);
    append(parent, heading, instructions, layout, check);
    if (state.orderFeedback) parent.appendChild(state.orderFeedback);
  }

  function checkOrder() {
    const correctPlaces = state.orderPicked.reduce((sum, item, place) => sum + (item === place ? 1 : 0), 0);
    if (correctPlaces === state.chapter.order.length) {
      state.orderFeedback = el('p', 'feedback good', 'Well done! That is the right order.');
    } else {
      state.orderFeedback = el('div', 'feedback kind');
      append(state.orderFeedback,
        el('p', '', `You have ${correctPlaces} event${correctPlaces === 1 ? '' : 's'} in the right place. Good try. Read the story again, then try once more.`)
      );
      const retry = makeButton('Try again', () => {
        prepareOrder();
        renderChapter();
      }, 'small-button');
      state.orderFeedback.appendChild(retry);
    }
    renderChapter();
  }

  function renderQuiz(parent) {
    if (state.completed) return renderCompletion(parent);
    const quiz = state.chapter.quiz[state.quizIndex];
    const heading = el('h2', '', 'Quick quiz');
    const count = el('p', 'quiet-note', `Question ${state.quizIndex + 1} of ${state.chapter.quiz.length}`);
    const question = el('p', 'quiz-question', quiz.q);
    const list = el('div', 'answer-list');
    quiz.options.forEach((option, index) => {
      let cls = 'answer-button';
      if (state.quizRight && index === quiz.answer) cls += ' is-right';
      if (state.quizWrong === index && !state.quizRight) cls += ' is-wrong';
      const answer = makeButton(option, () => {
        if (state.quizRight) return;
        if (index === quiz.answer) {
          state.quizRight = true;
          state.quizWrong = -1;
        } else {
          state.quizWrong = index;
        }
        renderChapter();
      }, cls, state.quizRight);
      list.appendChild(answer);
    });
    append(parent, heading, count, question, list);
    if (state.quizRight) {
      const response = el('div', 'feedback good');
      append(response, el('strong', '', 'Correct!'), el('p', '', quiz.why));
      const next = makeButton('Next', () => {
        if (state.quizIndex + 1 >= state.chapter.quiz.length) {
          finishChapter();
          renderChapter();
        } else {
          state.quizIndex += 1;
          state.quizRight = false;
          state.quizWrong = -1;
          renderChapter();
        }
      }, 'primary-button');
      append(response, next);
      parent.appendChild(response);
    } else if (state.quizWrong >= 0) {
      parent.appendChild(el('p', 'feedback kind', quiz.hint));
    }
  }

  function finishChapter() {
    state.completed = true;
    if (!state.progress.read.includes(state.chapterId)) state.progress.read.push(state.chapterId);
    state.progress.last = state.chapterId;
    saveProgress();
  }

  function nextReadyChapter() {
    const currentIndex = book.chapters.findIndex((chapter) => chapter.id === state.chapterId);
    return book.chapters.slice(currentIndex + 1).find((chapter) => chapter.ready) || null;
  }

  function renderCompletion(parent) {
    const card = el('section', 'completion-card');
    const title = el('h1', '', `Chapter ${state.chapterId} complete!`);
    const note = el('p', 'quiet-note', `You finished ${state.chapter.title}. You can read it again or return to the menu.`);
    const actions = el('div', 'completion-actions');
    const nextEntry = nextReadyChapter();
    const next = makeButton('Next chapter', nextEntry ? () => openChapter(nextEntry.id) : null, 'primary-button', !nextEntry);
    const menu = makeButton('Chapter menu', showMenu, 'small-button');
    append(actions, next, menu);
    append(card, title, note, actions);
    parent.appendChild(card);
  }

  function renderSayIt(parent) {
    const heading = el('h2', '', 'Say it');
    const line = el('p', 'say-line', state.chapter.sayIt.line);
    const controls = el('div', 'inline-actions');
    if (voiceReady()) {
      const hear = makeButton('Hear it', () => {
        if (state.reading) {
          stopSpeech();
          hear.textContent = 'Hear it';
        } else {
          speakLines([state.chapter.sayIt.line], hear, false);
        }
      }, 'small-button');
      controls.appendChild(hear);
    }
    const readPrompt = el('p', 'order-instructions', 'Now read it out loud yourself.');
    const talk = el('p', 'talk-question', `Talk about it: ${state.chapter.sayIt.talk}`);
    append(parent, heading, line, controls, readPrompt, talk);
  }

  function renderOriginalPanel() {
    const overlay = el('div', 'original-panel');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'original-title');
    const card = el('section', 'original-card');
    const title = el('h2', '', state.original.title || state.chapter.title);
    title.id = 'original-title';
    const note = `This is the original text from ${book.year}. Some words are old.`;
    const text = el('div', 'original-text', state.original.text);
    text.setAttribute('tabindex', '0');
    const close = makeButton('Close', () => {
      state.originalPanel = false;
      renderChapter();
    }, 'primary-button');
    append(card, title, el('p', 'original-note', note), text, close);
    overlay.appendChild(card);
    return overlay;
  }

  document.addEventListener('keydown', (event) => {
    if (state.screen !== 'chapter' || state.step !== 'story' || state.originalPanel || !state.chapter) return;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      movePage(-1);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      movePage(1);
    }
  });

  if (window.speechSynthesis) {
    window.speechSynthesis.addEventListener('voiceschanged', () => {
      if (state.screen === 'chapter' && state.chapter && !state.reading) renderChapter();
    });
  }

  renderStart();
}());
