import Foundation
import PDFKit

// Texte intégré d'un PDF (couche texte), page après page. Usage: pdftext <fichier> [pages max]
let args = CommandLine.arguments
guard args.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else { exit(1) }
let maxPages = args.count > 2 ? (Int(args[2]) ?? 40) : 40
var out = ""
for i in 0..<min(doc.pageCount, maxPages) {
    if let page = doc.page(at: i), let s = page.string {
        out += s + "\n"
    }
}
print(out)
