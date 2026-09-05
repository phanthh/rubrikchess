use rubrik_core::*;
fn main() {
    let g = Game::new(GameConfig::default());
    let t = std::time::Instant::now();
    let n = 1000;
    let mut total = 0;
    for _ in 0..n {
        total += g.all_moves().iter().map(|(_, m)| m.len()).sum::<usize>();
    }
    println!(
        "all_moves x{n}: {:?}/iter, {} moves",
        t.elapsed() / n,
        total / n as usize
    );
    for level in 2..=4 {
        let t = std::time::Instant::now();
        let mv = best_move(&g, level, 1);
        println!(
            "best_move level {level}: {:?} → {:?}",
            t.elapsed(),
            mv.map(|m| m.from())
        );
    }
    // midgame: open lines, many captures available → quiescence cost shows here
    let mut mid = Game::new(GameConfig::default());
    // greedy vs greedy ends in a quick king grab; alternate greedy / random instead
    for ply in 0..30 {
        let level = 3;
        let Some(mv) = best_move(&mid, level, ply) else {
            break;
        };
        mid.play(mv).unwrap();
        if mid.status != Status::Playing {
            break;
        }
    }
    println!(
        "midgame after {} plies, status {:?}",
        mid.history.len(),
        mid.status
    );
    for level in 3..=4 {
        let t = std::time::Instant::now();
        let mv = best_move(&mid, level, 1);
        println!(
            "midgame best_move level {level}: {:?} → {:?}",
            t.elapsed(),
            mv.map(|m| m.from())
        );
    }
}
