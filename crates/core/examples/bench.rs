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
}
