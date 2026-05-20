import json
import sys

from youtube_transcript_api import YouTubeTranscriptApi
from youtube_transcript_api.formatters import JSONFormatter, SRTFormatter, TextFormatter, WebVTTFormatter


FORMATTERS = {
    "json": JSONFormatter,
    "text": TextFormatter,
    "srt": SRTFormatter,
    "vtt": WebVTTFormatter,
}


def main():
    request = json.load(sys.stdin)
    action = request.get("action", "fetch")
    api = YouTubeTranscriptApi()

    if action == "list":
        print(json.dumps(list_transcripts(api, request), indent=2))
        return

    if action == "fetch":
        print(json.dumps(fetch_transcript(api, request), indent=2))
        return

    raise ValueError(f"Unsupported action: {action}")


def list_transcripts(api, request):
    transcript_list = api.list(request["video_id"])
    transcripts = []

    for transcript in transcript_list:
        transcripts.append(
            {
                "video_id": transcript.video_id,
                "language": transcript.language,
                "language_code": transcript.language_code,
                "is_generated": transcript.is_generated,
                "is_translatable": transcript.is_translatable,
                "translation_languages": transcript.translation_languages,
            }
        )

    return {
        "video_id": request["video_id"],
        "transcripts": transcripts,
    }


def fetch_transcript(api, request):
    languages = request.get("languages") or ["en"]
    preserve_formatting = bool(request.get("preserve_formatting", False))
    transcript_type = request.get("transcript_type", "any")
    translate_to = request.get("translate_to")
    output_format = request.get("format", "json")

    if translate_to:
        transcript = _find_transcript(api, request["video_id"], languages, transcript_type)
        fetched = transcript.translate(translate_to).fetch(preserve_formatting=preserve_formatting)
    elif transcript_type == "any":
        fetched = api.fetch(
            request["video_id"],
            languages=languages,
            preserve_formatting=preserve_formatting,
        )
    else:
        transcript = _find_transcript(api, request["video_id"], languages, transcript_type)
        fetched = transcript.fetch(preserve_formatting=preserve_formatting)

    return {
        "video_id": fetched.video_id,
        "language": fetched.language,
        "language_code": fetched.language_code,
        "is_generated": fetched.is_generated,
        "format": output_format,
        "transcript": _format_transcript(fetched, output_format),
    }


def _find_transcript(api, video_id, languages, transcript_type):
    transcript_list = api.list(video_id)
    if transcript_type == "manual":
        return transcript_list.find_manually_created_transcript(languages)
    if transcript_type == "generated":
        return transcript_list.find_generated_transcript(languages)
    return transcript_list.find_transcript(languages)


def _format_transcript(fetched, output_format):
    if output_format == "raw":
        return fetched.to_raw_data()

    formatter_class = FORMATTERS.get(output_format)
    if not formatter_class:
        raise ValueError(f"Unsupported format: {output_format}")

    return formatter_class().format_transcript(fetched)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
