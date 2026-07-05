local mp = require 'mp'

local function lower(value)
  if not value then
    return ''
  end
  return string.lower(value)
end

local function score_language(value, preferred)
  local normalized = lower(value)
  for index, candidate in ipairs(preferred) do
    if normalized == candidate or string.find(normalized, candidate, 1, true) then
      return index
    end
  end
  return nil
end

local function score_audio_track(track)
  local lang_score = score_language(track.lang, { 'ja', 'jpn', 'japanese', 'original', 'jp' })
  if lang_score then
    return lang_score
  end

  local title_score = score_language(track.title, { 'japanese', 'jpn', 'ja', 'original' })
  if title_score then
    return title_score + 10
  end

  local lowered_title = lower(track.title)
  if lowered_title ~= '' and (string.find(lowered_title, 'english', 1, true) or string.find(lowered_title, 'dub', 1, true)) then
    return 200
  end

  local lowered_lang = lower(track.lang)
  if lowered_lang ~= '' and (string.find(lowered_lang, 'english', 1, true) or string.find(lowered_lang, 'eng', 1, true)) then
    return 180
  end

  return 100
end

local function score_subtitle_track(track)
  local lang_score = score_language(track.lang, { 'en', 'eng', 'english' })
  local title_score = score_language(track.title, { 'english', 'full', 'dialogue', 'dialog' })
  local score = nil

  if lang_score then
    score = lang_score
  elseif title_score then
    score = title_score + 10
  else
    score = 100
  end

  local lowered_title = lower(track.title)
  if lowered_title ~= '' then
    if string.find(lowered_title, 'sign', 1, true) then
      score = score + 150
    end
    if string.find(lowered_title, 'song', 1, true) then
      score = score + 75
    end
    if string.find(lowered_title, 'forced', 1, true) then
      score = score + 40
    end
  end

  return score
end

local function pick_best_track(track_type)
  local track_list = mp.get_property_native('track-list') or {}
  local best_id = nil
  local best_score = nil

  for _, track in ipairs(track_list) do
    if track.type == track_type and track.id then
      local score = nil
      if track_type == 'audio' then
        score = score_audio_track(track)
      elseif track_type == 'sub' then
        score = score_subtitle_track(track)
      end

      if score and (not best_score or score < best_score) then
        best_score = score
        best_id = track.id
      end
    end
  end

  return best_id
end

local function apply_track_defaults()
  local audio_id = pick_best_track('audio')
  if audio_id then
    mp.set_property_number('aid', audio_id)
  end

  local subtitle_id = pick_best_track('sub')
  if subtitle_id then
    mp.set_property('sub-visibility', 'yes')
    mp.set_property_number('sid', subtitle_id)
  end
end

mp.register_event('file-loaded', apply_track_defaults)
