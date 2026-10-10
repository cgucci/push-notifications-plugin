#!/usr/bin/env python3
"""Minimal offline loopback client for Paper 26.3 (protocol 777).

Packet IDs checked against the installed server's LoginProtocols and
ConfigurationProtocols. Only completes login/configuration, drains play packets
for 14 seconds, then disconnects. Never connects to a public server.
"""
import io
import socket
import struct
import sys
import time
import zlib


def varint(number):
    result = bytearray()
    while True:
        byte = number & 0x7F
        number >>= 7
        result.append(byte | (0x80 if number else 0))
        if not number:
            return bytes(result)


def read_varint(stream):
    result = 0
    for index in range(5):
        byte = stream.read(1)
        if not byte:
            raise EOFError("Server closed connection")
        result |= (byte[0] & 0x7F) << (7 * index)
        if not byte[0] & 0x80:
            return result
    raise ValueError("Invalid VarInt")


def string(value):
    encoded = value.encode()
    return varint(len(encoded)) + encoded


port = int(sys.argv[1])
threshold = None
with socket.create_connection(("127.0.0.1", port), timeout=20) as connection:
    stream = connection.makefile("rb")

    def send(packet_id, payload=b""):
        data = varint(packet_id) + payload
        if threshold is not None:
            data = (varint(len(data)) + zlib.compress(data)) if len(data) >= threshold else b"\0" + data
        connection.sendall(varint(len(data)) + data)

    send(0, varint(777) + string("127.0.0.1") + struct.pack(">H", port) + varint(2))
    send(0, string("TelemetryTest") + bytes(16))
    state = "login"
    entered_at = None
    deadline = time.monotonic() + 45
    while time.monotonic() < deadline:
        length = read_varint(stream)
        data = stream.read(length)
        if len(data) != length:
            raise EOFError("Incomplete server packet")
        if threshold is not None:
            compressed = io.BytesIO(data)
            uncompressed_length = read_varint(compressed)
            data = compressed.read()
            if uncompressed_length:
                data = zlib.decompress(data)
                assert len(data) == uncompressed_length
        packet = io.BytesIO(data)
        packet_id = read_varint(packet)
        payload = packet.read()
        if state == "login":
            if packet_id == 0:
                raise RuntimeError("Login rejected: " + repr(payload))
            if packet_id == 1:
                raise RuntimeError("Test server must be offline and loopback-only")
            if packet_id == 3:
                threshold = read_varint(io.BytesIO(payload))
            elif packet_id == 2:
                send(3)
                state = "configuration"
        elif state == "configuration":
            if packet_id == 2:
                raise RuntimeError("Configuration rejected: " + repr(payload))
            if packet_id == 15:  # SelectKnownPacks, shifted by PostEffects in 26.3
                send(7, varint(0))
            elif packet_id == 20:
                send(9)  # AcceptCodeOfConduct
            elif packet_id == 4:
                send(4, payload)
            elif packet_id == 5:
                send(5, payload)
            elif packet_id == 0:
                send(1, payload + b"\0")  # no stored cookie
            elif packet_id == 3:
                send(3)
                state = "play"
                entered_at = time.monotonic()
                print("Entered play state", flush=True)
        elif entered_at and time.monotonic() - entered_at >= 14:
            print("Disconnecting after real online-player snapshot", flush=True)
            break
    else:
        raise TimeoutError("Login/configuration did not finish")
