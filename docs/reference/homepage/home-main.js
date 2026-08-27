(function () {
  var root = document.querySelector(".personal-home");
  if (!root) return;

  var revealNodes = root.querySelectorAll("[data-reveal]");
  var staggerItems = root.querySelectorAll("[data-stagger-item]");
  var projectCards = Array.prototype.slice.call(root.querySelectorAll("[data-project-card]"));
  var pointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
  var reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

  function showStaggerInSection(section) {
    var group = section.querySelector("[data-stagger-group]");
    if (!group) return;

    var items = group.querySelectorAll("[data-stagger-item]");
    if (!items.length) return;

    items.forEach(function (item, index) {
      window.setTimeout(function () {
        item.classList.add("is-stagger-visible");
      }, 70 + index * 105);
    });
  }

  function activateReveal() {
    if (!revealNodes.length) return;

    var prefersReducedMotion = reducedMotionQuery.matches;
    if (prefersReducedMotion || !("IntersectionObserver" in window)) {
      revealNodes.forEach(function (node) {
        node.classList.add("is-visible");
      });
      staggerItems.forEach(function (item) {
        item.classList.add("is-stagger-visible");
      });
      return;
    }

    root.classList.add("ph-has-motion");

    var observer = new IntersectionObserver(
      function (entries, io) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          showStaggerInSection(entry.target);
          io.unobserve(entry.target);
        });
      },
      {
        threshold: 0.18,
        rootMargin: "0px 0px -6% 0px",
      }
    );

    revealNodes.forEach(function (node) {
      observer.observe(node);
    });
  }

  function supportsHoverPreview() {
    return pointerQuery.matches;
  }

  function setCardFlipped(card, flipped) {
    card.classList.toggle("is-flipped", flipped);

    var toggle = card.querySelector("[data-project-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-pressed", flipped ? "true" : "false");
    }
  }

  function resetCards() {
    projectCards.forEach(function (card) {
      setCardFlipped(card, false);
    });
  }

  function getOpenCard() {
    var activeCard = null;

    projectCards.some(function (card) {
      if (!card.classList.contains("is-flipped")) return false;
      activeCard = card;
      return true;
    });

    return activeCard;
  }

  function openCard(card) {
    var activeCard = getOpenCard();
    if (activeCard === card) return;

    if (activeCard) {
      setCardFlipped(activeCard, false);
    }

    setCardFlipped(card, true);
  }

  function syncProjectBackContent() {
    projectCards.forEach(function (card) {
      var title = card.querySelector(".ph-project-title");
      var backTitle = card.querySelector(".ph-project-back-title");
      var tags = Array.prototype.slice.call(card.querySelectorAll(".ph-tags li"));
      var backNote = card.querySelector(".ph-project-back-note");

      if (title && backTitle) {
        backTitle.textContent = title.textContent.trim();
      }

      if (!backNote) return;

      backNote.textContent = "";

      tags.forEach(function (tag) {
        var tech = document.createElement("span");
        tech.className = "ph-project-back-tech";
        tech.textContent = tag.textContent.trim();
        backNote.appendChild(tech);
      });
    });
  }

  function handleCardActivation(card, event) {
    if (supportsHoverPreview()) return;

    event.stopPropagation();
    openCard(card);
  }

  function bindProjectCards() {
    if (!projectCards.length) return;

    projectCards.forEach(function (card) {
      var toggle = card.querySelector("[data-project-toggle]");

      if (toggle) {
        toggle.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();

          handleCardActivation(card, event);

          if (!supportsHoverPreview()) {
            toggle.blur();
          }
        });
      }

      card.addEventListener("click", function (event) {
        handleCardActivation(card, event);
      });

      card.addEventListener("mouseleave", function () {
        if (!supportsHoverPreview()) return;
        setCardFlipped(card, false);
      });

      card.addEventListener("focusout", function (event) {
        if (!supportsHoverPreview()) return;
        if (event.relatedTarget && card.contains(event.relatedTarget)) return;
        setCardFlipped(card, false);
      });
    });

    function handlePointerModeChange() {
      resetCards();
    }

    if (typeof pointerQuery.addEventListener === "function") {
      pointerQuery.addEventListener("change", handlePointerModeChange);
    } else if (typeof pointerQuery.addListener === "function") {
      pointerQuery.addListener(handlePointerModeChange);
    }

    document.addEventListener("click", function () {
      if (supportsHoverPreview()) return;
      if (!getOpenCard()) return;
      resetCards();
    });
  }

  activateReveal();
  syncProjectBackContent();
  bindProjectCards();
})();
