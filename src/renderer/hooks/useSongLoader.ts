import { useEffect, useState } from 'react';
import { App } from 'antd';
import { useNavigate } from 'react-router-dom';
import {
  AudioData,
  IpcLoadSongResponse,
  IpcResult,
  isIpcError,
  Song,
} from '../../types';
import { TrackConfig } from '../services/audio-player/types';
import { isCoveredByBacking } from '../../songData';

/**
 * Devices with 4 GB of RAM or less (Chromium's navigator.deviceMemory; other
 * browsers don't say). Decoded stems take about 90 MB each for a 4-minute
 * song, so a fully split song can be more than such a tab is allowed.
 */
export function isLowMemoryDevice(): boolean {
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;

  return typeof memory === 'number' && memory <= 4;
}

/**
 * The song's tracks for the player: its drum audio as one track, then every
 * other file. With `preferBacking`, a song that has the stem server's backing
 * mix plays that one file instead of the instrument stems it was mixed from.
 */
export function buildTrackData(
  song: Pick<Song, 'audio' | 'backing'>,
  preferBacking: boolean,
): TrackConfig[] {
  const drums = song.audio
    .filter((file: AudioData) => file.name.includes('drums'))
    .map((file: AudioData) => file.src);
  const useBacking = preferBacking && song.backing !== undefined;
  const other = song.audio
    .filter((file: AudioData) => !file.name.includes('drums'))
    .filter((file: AudioData) => !useBacking || !isCoveredByBacking(file))
    .map((file: AudioData) => ({ urls: [file.src], name: file.name }));

  return [
    ...(drums.length ? [{ name: 'drums', urls: drums }] : []),
    ...(useBacking && song.backing
      ? [{ name: song.backing.name, urls: [song.backing.src] }]
      : []),
    ...other,
  ];
}

interface SongLoaderResult {
  fileData: Buffer | undefined;
  format: 'mid' | 'chart';
  songData: Song | undefined;
  trackData: TrackConfig[];
}

export function useSongLoader(id: string | undefined): SongLoaderResult {
  const [fileData, setFileData] = useState<Buffer>();
  const [format, setFormat] = useState<'mid' | 'chart'>('mid');
  const [songData, setSongData] = useState<Song>();
  const [trackData, setTrackData] = useState<TrackConfig[]>([]);
  const { notification } = App.useApp();
  const navigate = useNavigate();

  useEffect(() => {
    const off = window.electron.ipcRenderer.once<
      IpcResult<IpcLoadSongResponse>
    >('load-song', (payload) => {
      if (isIpcError(payload)) {
        notification.error({
          title: "Couldn't open this song",
          description:
            'The chart file may have been moved or deleted. Rescan your library from the song list to refresh it.',
          placement: 'bottomRight',
        });
        navigate('/');

        return;
      }

      const { data, fileData: fd } = payload;

      setFileData(fd);
      setFormat(data.format);
      setSongData(data);

      setTrackData(buildTrackData(data, isLowMemoryDevice()));
    });

    window.electron.ipcRenderer.sendMessage('load-song', id);

    return off;
  }, [id, notification, navigate]);

  return { fileData, format, songData, trackData };
}
