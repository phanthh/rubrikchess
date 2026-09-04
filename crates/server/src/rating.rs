//! Glicko-2 (Glickman 2013), one game per rating period.

pub const DEFAULT_RATING: f64 = 1500.0;
pub const DEFAULT_RD: f64 = 350.0;
pub const DEFAULT_VOL: f64 = 0.06;

const TAU: f64 = 0.5;
const SCALE: f64 = 173.7178;
const EPS: f64 = 1e-6;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Rating {
    pub r: f64,
    pub rd: f64,
    pub vol: f64,
}

impl Default for Rating {
    fn default() -> Rating {
        Rating {
            r: DEFAULT_RATING,
            rd: DEFAULT_RD,
            vol: DEFAULT_VOL,
        }
    }
}

/// New ratings for both players after one game; `score_a` is 1 / 0.5 / 0.
pub fn update(a: &Rating, b: &Rating, score_a: f64) -> (Rating, Rating) {
    (
        update_one(a, &[(*b, score_a)]),
        update_one(b, &[(*a, 1.0 - score_a)]),
    )
}

/// One rating period: `player` against every `(opponent, score)`.
fn update_one(player: &Rating, games: &[(Rating, f64)]) -> Rating {
    let mu = (player.r - DEFAULT_RATING) / SCALE;
    let phi = player.rd / SCALE;
    if games.is_empty() {
        // Step 6: no games, only the deviation grows.
        let phi_new = (phi * phi + player.vol * player.vol).sqrt();
        return Rating {
            r: player.r,
            rd: phi_new * SCALE,
            vol: player.vol,
        };
    }

    let mut v_inv = 0.0;
    let mut delta_sum = 0.0;
    for (opp, score) in games {
        let mu_j = (opp.r - DEFAULT_RATING) / SCALE;
        let phi_j = opp.rd / SCALE;
        let g = g(phi_j);
        let e = e(mu, mu_j, phi_j);
        v_inv += g * g * e * (1.0 - e);
        delta_sum += g * (score - e);
    }
    let v = 1.0 / v_inv;
    let delta = v * delta_sum;

    let vol = new_vol(phi, v, delta, player.vol);
    let phi_star = (phi * phi + vol * vol).sqrt();
    let phi_new = 1.0 / (1.0 / (phi_star * phi_star) + v_inv).sqrt();
    let mu_new = mu + phi_new * phi_new * delta_sum;

    Rating {
        r: mu_new * SCALE + DEFAULT_RATING,
        rd: phi_new * SCALE,
        vol,
    }
}

fn g(phi: f64) -> f64 {
    1.0 / (1.0 + 3.0 * phi * phi / (std::f64::consts::PI * std::f64::consts::PI)).sqrt()
}

fn e(mu: f64, mu_j: f64, phi_j: f64) -> f64 {
    1.0 / (1.0 + (-g(phi_j) * (mu - mu_j)).exp())
}

/// Step 5: solve for the new volatility with the Illinois variant of regula falsi.
fn new_vol(phi: f64, v: f64, delta: f64, vol: f64) -> f64 {
    let a = (vol * vol).ln();
    let f = |x: f64| {
        let ex = x.exp();
        let d2 = delta * delta;
        let p2 = phi * phi;
        (ex * (d2 - p2 - v - ex)) / (2.0 * (p2 + v + ex).powi(2)) - (x - a) / (TAU * TAU)
    };

    let mut big_a = a;
    let mut big_b = if delta * delta > phi * phi + v {
        (delta * delta - phi * phi - v).ln()
    } else {
        let mut k = 1.0;
        while f(a - k * TAU) < 0.0 {
            k += 1.0;
        }
        a - k * TAU
    };
    let mut f_a = f(big_a);
    let mut f_b = f(big_b);
    while (big_b - big_a).abs() > EPS {
        let c = big_a + (big_a - big_b) * f_a / (f_b - f_a);
        let f_c = f(c);
        if f_c * f_b <= 0.0 {
            big_a = big_b;
            f_a = f_b;
        } else {
            f_a /= 2.0;
        }
        big_b = c;
        f_b = f_c;
    }
    (big_a / 2.0).exp()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn glickman_worked_example() {
        // Paper §Example: 1500/200/0.06 vs 1400/30 (win), 1550/100 (loss), 1700/300 (loss).
        let player = Rating {
            r: 1500.0,
            rd: 200.0,
            vol: 0.06,
        };
        let games = [
            (
                Rating {
                    r: 1400.0,
                    rd: 30.0,
                    vol: 0.06,
                },
                1.0,
            ),
            (
                Rating {
                    r: 1550.0,
                    rd: 100.0,
                    vol: 0.06,
                },
                0.0,
            ),
            (
                Rating {
                    r: 1700.0,
                    rd: 300.0,
                    vol: 0.06,
                },
                0.0,
            ),
        ];
        let out = update_one(&player, &games);
        assert!((out.r - 1464.06).abs() < 0.01, "r = {}", out.r);
        assert!((out.rd - 151.52).abs() < 0.01, "rd = {}", out.rd);
        assert!((out.vol - 0.05999).abs() < 0.0001, "vol = {}", out.vol);
    }

    #[test]
    fn win_raises_and_diffs_are_opposite() {
        let a = Rating::default();
        let b = Rating::default();
        let (a2, b2) = update(&a, &b, 1.0);
        assert!(a2.r > a.r);
        assert!(b2.r < b.r);
        assert!(((a2.r - a.r) + (b2.r - b.r)).abs() < 1e-9);
        // A draw between equals moves nobody, but sharpens both deviations.
        let (a3, b3) = update(&a, &b, 0.5);
        assert!((a3.r - a.r).abs() < 1e-9 && (b3.r - b.r).abs() < 1e-9);
        assert!(a3.rd < a.rd && b3.rd < b.rd);
    }
}
