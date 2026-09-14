# Apple ASR regression excerpt

Source: https://www.youtube.com/watch?v=6dKFNpYcIn8

The user supplied the English JSON3 attachment and pasted the Polish JSON3 response.
These fixtures contain the six complete caption events from that excerpt (0.16s through
13.2s), including window and newline events. The unfinished trailing event was omitted.
Polish segment whitespace was normalized; supplied words, offsets and event times remain.
The final sentence is incomplete because the user excerpt ends at “Tucker” / “i jestem”.
Do not treat the last rolling-window duration as the full video's next sentence boundary.
