import pytest

from job_radar.config import ProfileConfig, ScoringConfig, load_config
from job_radar.models import JobListing
from job_radar.scoring import normalize, score_listing, suggest_profile


@pytest.fixture
def config() -> ScoringConfig:
    return ScoringConfig(
        profiles=[
            ProfileConfig(
                key="qa",
                name="QA Automation",
                keywords={"qa": 3, "selenium": 3, "playwright": 3, "python": 2},
            ),
            ProfileConfig(
                key="dev",
                name="Desarrollador",
                keywords={"react": 3, "node": 2, "typescript": 3},
            ),
        ],
        bonus={"junior": 2, "remoto": 2, "hibrido": 1},
        penalties={"senior": -3, "lead": -3},
    )


def make_listing(title: str = "", description: str = "", location: str = "") -> JobListing:
    return JobListing(
        title=title,
        company="Acme",
        url="https://example.com/job/1",
        description=description,
        location=location,
    )


def test_normalize_strips_accents_and_lowercases():
    assert normalize("Híbrido CABA/GBA Norte") == "hibrido caba/gba norte"


def test_normalize_collapses_whitespace():
    assert normalize("full   stack\n\tdeveloper") == "full stack developer"


def test_keyword_match_is_case_insensitive(config):
    listing = make_listing(title="Se busca QA Tester con Selenium y Playwright")
    result = next(r for r in score_listing(listing, config) if r.profile_key == "qa")
    assert result.score == 9  # qa(3) + selenium(3) + playwright(3)
    assert set(result.matched_keywords) == {"qa", "selenium", "playwright"}


def test_keyword_does_not_match_as_substring(config):
    # "qa" no debe matchear dentro de "Qatar" ni "Aquarium"
    listing = make_listing(title="Vendedor en tienda Qatar Aquarium")
    result = next(r for r in score_listing(listing, config) if r.profile_key == "qa")
    assert result.matched_keywords == []
    assert result.score == 0


def test_bonus_junior_and_remoto_increase_score(config):
    listing = make_listing(title="QA Junior, remoto")
    result = next(r for r in score_listing(listing, config) if r.profile_key == "qa")
    assert "junior" in result.matched_bonus
    assert "remoto" in result.matched_bonus
    assert result.score == 3 + 2 + 2  # qa + junior + remoto


def test_penalty_senior_reduces_score(config):
    listing = make_listing(title="React Developer Senior, +5 años de experiencia")
    result = next(r for r in score_listing(listing, config) if r.profile_key == "dev")
    assert "senior" in result.matched_penalties
    assert result.score == 3 - 3  # react - senior


def test_bonus_and_penalty_apply_to_every_profile(config):
    # remoto/junior no son especificos de un perfil: deben sumar en todos.
    listing = make_listing(title="Puesto junior, remoto, sin stack definido")
    results = score_listing(listing, config)
    assert all(r.score == 4 for r in results)  # solo bonus junior(2) + remoto(2)


def test_suggest_profile_picks_highest_score(config):
    listing = make_listing(
        title="QA Automation Tester con Playwright y Selenium",
        description="Buscamos perfil junior",
    )
    best = suggest_profile(listing, config)
    assert best.profile_key == "qa"


def test_multiword_keyword_matches_with_flexible_spacing():
    scoring_config = ScoringConfig(
        profiles=[ProfileConfig(key="dev", name="Desarrollador", keywords={"full stack": 3})],
        bonus={},
        penalties={},
    )
    listing = make_listing(title="Full   Stack Developer")
    result = score_listing(listing, scoring_config)[0]
    assert result.score == 3
    assert result.matched_keywords == ["full stack"]


def test_results_sorted_by_score_descending(config):
    listing = make_listing(title="React Typescript Node QA Selenium Playwright")
    results = score_listing(listing, config)
    scores = [r.score for r in results]
    assert scores == sorted(scores, reverse=True)


def test_real_config_loads_and_has_expected_profiles():
    scoring_config = load_config()
    keys = {p.key for p in scoring_config.profiles}
    assert keys == {"qa_automation", "desarrollador", "contable_automatizacion"}
    assert "senior" in scoring_config.penalties
    assert "junior" in scoring_config.bonus


def test_real_config_qa_profile_scores_qa_listing():
    scoring_config = load_config()
    listing = make_listing(
        title="QA Automation Engineer - Selenium, Playwright, Python",
        description="Buscamos tester junior, remoto, para testing de APIs",
    )
    best = suggest_profile(listing, scoring_config)
    assert best.profile_key == "qa_automation"


def test_real_config_penalizes_senior_lead_listing():
    scoring_config = load_config()
    listing = make_listing(
        title="Senior Backend Lead, Node y NestJS, +5 años de experiencia",
    )
    dev_result = next(
        r for r in score_listing(listing, scoring_config) if r.profile_key == "desarrollador"
    )
    assert dev_result.score < 0
