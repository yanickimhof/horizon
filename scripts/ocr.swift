// Reconnaissance de texte locale (macOS, framework Vision). Rien ne quitte l'ordinateur.
// Usage: ocr <fichier pdf ou image> [pages max]
import Foundation
import PDFKit
import Vision
import AppKit

let args = CommandLine.arguments
guard args.count >= 2 else { print("usage: ocr <fichier> [pages]"); exit(2) }
let path = args[1]
let maxPages = args.count >= 3 ? (Int(args[2]) ?? 12) : 12

/// Regroupe les morceaux de texte reconnus par ligne visuelle (même hauteur), de gauche à droite.
/// Sans cela, les colonnes d'un relevé (date, libellé, montant) sortent l'une après l'autre et le lien entre elles est perdu.
func rows(_ results: [VNRecognizedTextObservation]) -> [String] {
    var items: [(String, CGFloat, CGFloat, CGFloat)] = []
    for o in results {
        guard let s = o.topCandidates(1).first?.string else { continue }
        let b = o.boundingBox
        items.append((s, b.minX, b.midY, b.height))
    }
    items.sort { $0.2 > $1.2 }
    var groups: [[(String, CGFloat, CGFloat, CGFloat)]] = []
    for it in items {
        if let ref = groups.last?.first, abs(ref.2 - it.2) < max(it.3, ref.3) * 0.6 {
            groups[groups.count - 1].append(it)
        } else {
            groups.append([it])
        }
    }
    return groups.map { g in g.sorted { $0.1 < $1.1 }.map { $0.0 }.joined(separator: "  ") }
}

func recognize(_ cg: CGImage) -> [String] {
    let req = VNRecognizeTextRequest()
    req.recognitionLevel = .accurate
    req.recognitionLanguages = ["fr-FR", "en-US", "de-DE"]
    let handler = VNImageRequestHandler(cgImage: cg, options: [:])
    try? handler.perform([req])
    return rows(req.results ?? [])
}

if path.lowercased().hasSuffix(".pdf") {
    guard let doc = PDFDocument(url: URL(fileURLWithPath: path)) else { exit(1) }
    for i in 0..<min(doc.pageCount, maxPages) {
        guard let page = doc.page(at: i) else { continue }
        let box = page.bounds(for: .mediaBox)
        let size = NSSize(width: box.width * 2.2, height: box.height * 2.2)
        let img = page.thumbnail(of: size, for: .mediaBox)
        guard let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let cg = rep.cgImage else { continue }
        print("=== PAGE \(i + 1)")
        for line in recognize(cg) { print(line) }
    }
} else {
    guard let img = NSImage(contentsOfFile: path), let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let cg = rep.cgImage else { exit(1) }
    for line in recognize(cg) { print(line) }
}
