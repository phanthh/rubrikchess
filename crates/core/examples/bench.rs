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
}
